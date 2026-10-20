/**
 * Seeding from Bun or Node with the application itself. A seed client is a device of the
 * application in this process: the composition root over an in-memory database, signing up
 * or in through the gateway's HTTP routes, writing the profile with the user module's
 * services, the command bus and the Loro write path of the identity's region, and syncing
 * the region over the gateway's WebSocket like any device. A stand is reached directly only
 * by its operator, as a system user on the gateway's database, to sweep seeded accounts.
 * Never part of the browser bundle.
 */

import { err, errAsync, okAsync, type Result, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import {
  type AuthUser,
  type DataError,
  dataError,
  openLocalDb,
  type SignInInput,
} from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { readSchema } from '@workspace/data/schema-files'
import type { Locale } from '@workspace/i18n'
import { type ProfileId, profileIdFactory } from '@workspace/ids'
import { systemClock } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'
import { type LockManagerLike, syncHints, WebSocketTransport } from '@workspace/replica/sync'

import {
  NOTES_SERVICE,
  type NoteRow,
  type NotesService,
} from '../features/organisation/application/notes.service'
import { OrganisationModule } from '../features/organisation/organisation.module'
import {
  PROFILE_SERVICE,
  type ProfileRow,
  type ProfileService,
} from '../features/user/application/profile.service'
import { UserModule } from '../features/user/user.module'

import type { CommandLogger } from './commands'
import { devicesApi } from './devices-api'
import { type Fetcher, gatewayAuth } from './gateway-auth'
import { organisationsApi } from './organisations-api'
import { type AppServices, createAppRoot } from './root'
import { memoryStorage } from './storage'

export type { NoteRow } from '../features/organisation/application/notes.service'
export type { ProfileRow } from '../features/user/application/profile.service'
export { checkProfileName } from '../features/user/domain/profile-name.rule'

export type { Fetcher } from './gateway-auth'
export { openStand, type Stand, type StandOptions } from './seed-stand'

export interface ClientOptions {
  /** The gateway's address, such as `http://127.0.0.1:5181`; its sync WebSocket is `/sync` under it. */
  readonly gatewayUrl: string
  /**
   * What the client calls the gateway's HTTP routes with, the global `fetch` by default: a test
   * that talks to the gateway directly plays the front with it, naming a client address.
   */
  readonly fetcher?: Fetcher
  readonly logger?: CommandLogger
}

export interface AccountInput {
  readonly email: string
  readonly password: string
  readonly name: string
  readonly bio: string
  readonly locale: Locale
}

export interface SeededAccount {
  readonly user: AuthUser
  readonly profileId: ProfileId
}

/** An account as a device sees it once it has caught up with the gateway. */
export interface AccountView {
  readonly user: AuthUser
  readonly profile: ProfileRow | undefined
}

/** An organisation as a member's device sees it once it has caught up with the gateway. */
export interface OrganisationView {
  readonly membership: Membership
  readonly notes: readonly NoteRow[]
}

export type SeedError = DataError | BusError

/**
 * One device, signed in as one account at a time: signing in as the next account leaves the
 * previous one, and closing leaves the last one. Leaving closes the account's space and drops
 * its in-memory database, but never signs the account out, which would revoke its grant.
 */
export interface SeedClient {
  /** Signs up (or in, when the account exists), writes the profile through commands and waits until the gateway acknowledged everything. */
  ensureAccount(input: AccountInput): ResultAsync<SeededAccount, SeedError>
  /** Signs in as an existing account and waits for the first catch-up; the organisation calls act as it. */
  signIn(input: SignInInput): ResultAsync<AuthUser, SeedError>
  /**
   * Creates the organisation as the signed-in account, its administrator. An organisation that
   * exists and is already the account's (the gateway completes its creator's interrupted
   * provisioning on a retry) is found; any other refusal is an error.
   */
  ensureOrganisation(input: {
    readonly key: string
    readonly name: string
  }): ResultAsync<Membership, SeedError>
  /** Invites the existing account at `email` into the organisation as the signed-in administrator; a member already in it is found. */
  ensureMember(key: string, email: string): ResultAsync<void, SeedError>
  /** Signs in, makes the organisation current and reads its notes once the gateway's copy has arrived; writes nothing. */
  readOrganisation(key: string, input: SignInInput): ResultAsync<OrganisationView, SeedError>
  /** Signs in and reads the profile once the gateway's copy of the account's region has arrived; writes nothing. */
  readAccount(input: SignInInput): ResultAsync<AccountView, SeedError>
  close(): Promise<void>
}

/** How long the client waits, each time, for the gateway to answer and acknowledge. */
const SETTLE_MS = 15_000

const silent: CommandLogger = { info: () => {}, warn: () => {} }

/** Web Locks for a process that is its identity's only device: each request is granted at once. */
const soleDevice: LockManagerLike = {
  request: (_name, _options, callback) => callback(),
}

/** The gateway's sync WebSocket under its address: `http(s)://…` becomes `ws(s)://…/sync`. */
function gatewaySyncUrl(gatewayUrl: string): string {
  return `${gatewayUrl.replace(/^http/, 'ws')}/sync`
}

function seedClient(services: AppServices, failures: DataError[]): SeedClient {
  const scope = services.container.child()

  for (const provider of UserModule.providers) {
    scope.singleton(provider.provide, provider.useFactory)
  }

  const profiles: ProfileService = scope.get(PROFILE_SERVICE)

  for (const provider of OrganisationModule.providers) {
    scope.singleton(provider.provide, provider.useFactory)
  }

  const notes: NotesService = scope.get(NOTES_SERVICE)

  /** The outcome of `work`, unless the space reported a failure meanwhile: that comes first. */
  const reported = <T>(work: ResultAsync<T, SeedError>): ResultAsync<T, SeedError> => {
    const outcome = async (): Promise<Result<T, SeedError>> => {
      const result = await work
      const [failure] = failures.splice(0)

      return failure ? err(failure) : result
    }

    return new ResultAsync(outcome())
  }

  /** Waits until the gateway answered and acknowledged everything, and the region is projected. */
  const settle = (): ResultAsync<void, SeedError> => {
    const sync = services.space()?.sync

    if (!sync) {
      return errAsync(
        dataError('data:SYNC_STOPPED', 'the seed client does not lead the sync of its identity'),
      )
    }

    return reported(
      ResultAsync.fromPromise(sync.settled(SETTLE_MS), (cause) =>
        dataError(
          'data:SYNC_STOPPED',
          `the gateway did not answer and acknowledge within ${SETTLE_MS / 1000} s`,
          cause,
        ),
      ).andThen(() => services.session.flush()),
    )
  }

  /**
   * Signs in and waits for the first catch-up, which brings what the gateway holds. The client is
   * one device, which holds one account at a time: the account it is in signs out first.
   */
  const enter = (
    signIn: () => ResultAsync<AuthUser, DataError>,
  ): ResultAsync<AuthUser, SeedError> =>
    (services.session.current() === undefined
      ? okAsync<void, SeedError>(undefined)
      : services.session
          .signOut()
          .andThen((outcome) =>
            outcome === 'signed-out'
              ? okAsync(undefined)
              : errAsync(
                  dataError('data:WRITE_FAILED', 'the account kept changes it could not send'),
                ),
          )
    )
      .andThen(signIn)
      .andThen((user) => settle().map(() => user))

  const profileOf = (user: AuthUser): ResultAsync<ProfileRow | undefined, SeedError> =>
    profiles.read({ identity: user.id }).map(([row]) => row)

  /** The account's profile as the catalog describes it: created when missing, its language and bio set. */
  const ensureProfile = (user: AuthUser, input: AccountInput): ResultAsync<ProfileId, SeedError> =>
    profileOf(user)
      .andThen((row): ResultAsync<Pick<ProfileRow, 'id' | 'bio' | 'locale'>, SeedError> => {
        if (row) {
          return okAsync(row)
        }

        const id = profileIdFactory.create()

        return profiles
          .createProfile({ id, identity: user.id, name: input.name, email: input.email })
          .map(() => ({ id, bio: undefined, locale: undefined }))
      })
      .andThen((profile) =>
        (profile.locale === input.locale
          ? okAsync(undefined)
          : profiles.updateLocale({ id: profile.id, locale: input.locale })
        )
          .andThen(() =>
            profile.bio === input.bio
              ? okAsync(undefined)
              : profiles.updateBio({ id: profile.id, bio: input.bio }),
          )
          .map(() => profile.id),
      )

  const membershipOf = (key: string): Membership | undefined =>
    services.session.memberships().find((membership) => membership.tenant.key === key)

  const ensureOrganisation = (input: {
    readonly key: string
    readonly name: string
  }): ResultAsync<Membership, SeedError> =>
    services.organisations
      .create(input)
      .orElse((error) => {
        const found = error.code === 'data:WRITE_REJECTED' && error.message === 'key-taken'
        const existing = found ? membershipOf(input.key) : undefined

        return existing ? okAsync(existing) : errAsync(error)
      })
      .andThen((membership) => settle().map(() => membership))

  const ensureMember = (key: string, email: string): ResultAsync<void, SeedError> =>
    services.organisations
      .invite(key, email)
      .map(() => undefined)
      .orElse((error) =>
        error.code === 'data:WRITE_REJECTED' && error.message === 'already-member'
          ? okAsync(undefined)
          : errAsync(error),
      )

  const readOrganisation = (
    key: string,
    input: SignInInput,
  ): ResultAsync<OrganisationView, SeedError> =>
    enter(() => services.session.signIn(input)).andThen(() => {
      services.session.selectTenant(key)
      const membership = services.session.currentTenant()

      return membership?.tenant.key === key
        ? settle()
            .andThen(() => notes.read())
            .map((rows) => ({ membership, notes: rows }))
        : errAsync<OrganisationView, SeedError>(
            dataError('data:AUTH_FAILED', `the account is no member of ${key}`),
          )
    })

  return {
    signIn: (input) => enter(() => services.session.signIn(input)),
    ensureOrganisation,
    ensureMember,
    readOrganisation,
    ensureAccount: (input) =>
      enter(() =>
        services.session
          .signUp(input)
          .orElse((error) =>
            error.code === 'data:SIGN_UP_REJECTED'
              ? services.session.signIn(input)
              : errAsync(error),
          ),
      )
        .andThen((user) => ensureProfile(user, input).map((profileId) => ({ user, profileId })))
        .andThen((seeded) => settle().map(() => seeded)),
    readAccount: (input) =>
      enter(() => services.session.signIn(input)).andThen((user) =>
        profileOf(user).map((profile) => ({ user, profile })),
      ),
    close: () => services.close(),
  }
}

/**
 * Opens a seed client: the application's composition root over the gateway at `gatewayUrl`,
 * with an in-memory database for each identity it signs in as. It always leads its
 * identity's sync, has no other tab to hint, and stays in the foreground.
 */
export function openClient(options: ClientOptions): ResultAsync<SeedClient, DataError> {
  const schema = readSchema('directory')
  const tenantSchema = readSchema('tenant')
  // The space reports asynchronously (the projector, the sync engine); a seed fails on the first report.
  const failures: DataError[] = []
  const fetcher: Fetcher = options.fetcher ?? fetch

  return createAppRoot({
    openLocal: () =>
      openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: 'app',
        database: 'identity',
        schema,
      }),
    openTenantLocal: () =>
      openLocalDb({
        engines: nodeEngines(),
        url: 'mem://',
        namespace: 'app',
        database: 'tenant',
        schema: tenantSchema,
      }),
    // An in-memory database leaves nothing behind once it is closed.
    deleteLocal: () => okAsync(undefined),
    deleteTenantLocal: () => okAsync(undefined),
    gatewayAuth: gatewayAuth(options.gatewayUrl, fetcher),
    // The client names itself with an id minted into its memory storage, as a browser does.
    deviceLabel: 'Seed client',
    online: () => true,
    organisationsApi: (deps) => organisationsApi(options.gatewayUrl, { ...deps, fetcher }),
    devicesApi: (deps) => devicesApi(options.gatewayUrl, { ...deps, fetcher }),
    transport: (context) =>
      new WebSocketTransport({
        url: gatewaySyncUrl(options.gatewayUrl),
        device: context.device,
        credentials: context.credentials,
        onTokens: context.onTokens,
        onRenewalRefused: context.onRenewalRefused,
        onMemberships: context.onMemberships,
        onEnded: context.onEnded,
        clock: systemClock,
      }),
    locks: soleDevice,
    hints: () => syncHints(undefined),
    clock: systemClock,
    storage: memoryStorage(),
    visibility: { current: () => 'visible', onChange: () => () => {} },
    logger: options.logger ?? silent,
    onError: (error) => failures.push(error),
    onSyncState: () => {},
  })
    .mapErr(({ error }) => error)
    .map((services) => seedClient(services, failures))
}
