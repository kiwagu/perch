/**
 * The seed client: a device of the application in this process, the composition root over an
 * in-memory database, signing in through the gateway's HTTP routes (and up, verifying each new
 * account through the mail in the stand's mailbox), writing with the user and organisation
 * modules' services, and syncing the identity's region over the gateway's WebSocket like any
 * device.
 */

import { err, errAsync, okAsync, type Result, ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, openLocalDb } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { readSchema } from '@workspace/data/schema-files'
import { systemClock } from '@workspace/replica'
import { type LockManagerLike, syncHints } from '@workspace/replica/sync'

import {
  NOTES_SERVICE,
  type NotesService,
} from '../../features/organisation/application/notes.service'
import { OrganisationModule } from '../../features/organisation/organisation.module'
import {
  ACCOUNT_START_SERVICE,
  type AccountStartService,
} from '../../features/user/application/account-start.service'
import {
  PROFILE_SERVICE,
  type ProfileService,
} from '../../features/user/application/profile.service'
import {
  SETTINGS_SERVICE,
  type SettingsService,
} from '../../features/user/application/settings/settings.service'
import { UserModule } from '../../features/user/user.module'
import { INVITATIONS } from '../../platform/invitations.port'
import { accountsApi } from '../accounts-api'
import type { CommandLogger } from '../commands'
import { devicesApi } from '../devices-api'
import { type Fetcher, gatewayAuth } from '../gateway-auth'
import { invitationsApi } from '../invitations-api'
import { organisationsApi } from '../organisations-api'
import { type AppServices, createAppRoot } from '../root'
import { type KeyValueStorage, memoryStorage, savedSession } from '../storage'
import { syncTransport } from '../sync-transport'

import { ensureAccount, readAccount } from './accounts'
import { ensureInvited, ensureJoined, ensureOrganisation, readOrganisation } from './organisations'
import type {
  ClientOptions,
  Inbox,
  SeedClient,
  SeedDevice,
  SeedError,
  SeedOrganisationDevice,
  SeedStarts,
} from './types'

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

function seedClient(
  services: AppServices,
  failures: DataError[],
  inbox: Inbox,
  storage: KeyValueStorage,
): SeedClient {
  const scope = services.container.child()

  for (const provider of UserModule.providers) {
    scope.singleton(provider.provide, provider.useFactory)
  }

  const profiles: ProfileService = scope.get(PROFILE_SERVICE)
  const settings: SettingsService = scope.get(SETTINGS_SERVICE)

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

  // The client is one device, which holds one account at a time: the account it is in signs out
  // first.
  const enter = (
    signIn: () => ResultAsync<AuthUser, SeedError>,
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

  const device: SeedDevice & SeedOrganisationDevice = {
    session: services.session,
    organisations: services.organisations,
    invitations: services.container.get(INVITATIONS),
    profiles,
    settings,
    starts: seedStarts(services.container.get(ACCOUNT_START_SERVICE), storage),
    notes,
    inbox,
    enter,
    settle,
  }

  return {
    signIn: (input) => enter(() => services.session.signIn(input)),
    ensureOrganisation: (input) => ensureOrganisation(device, input),
    ensureInvited: (key, email) => ensureInvited(device, key, email),
    ensureJoined: (invitation) => ensureJoined(device, invitation),
    readOrganisation: (key, input) => readOrganisation(device, key, input),
    ensureAccount: (input) => ensureAccount(device, input),
    readAccount: (input) => readAccount(device, input),
    close: () => services.close(),
  }
}

/**
 * Opens a seed client: the application's composition root over the gateway at `gatewayUrl`,
 * with an in-memory database for each identity it signs in as, reading the verification mails of
 * the accounts it signs up in `inbox`. It always leads its identity's sync, has no other tab to
 * hint, and stays in the foreground.
 */
export function openClient(options: ClientOptions): ResultAsync<SeedClient, DataError> {
  const schema = readSchema('directory')
  const tenantSchema = readSchema('tenant')
  // The space reports asynchronously (the projector, the sync engine); a seed fails on the first report.
  const failures: DataError[] = []
  const fetcher: Fetcher = options.fetcher ?? fetch
  const storage = memoryStorage()

  const start = createAppRoot({
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
    // The client shows nothing: an account it starts follows each device's own setting.
    theme: () => 'system',
    online: () => true,
    onOnlineChange: () => () => {},
    organisationsApi: (deps) => organisationsApi(options.gatewayUrl, { ...deps, fetcher }),
    devicesApi: (deps) => devicesApi(options.gatewayUrl, { ...deps, fetcher }),
    invitationsApi: (deps) => invitationsApi(options.gatewayUrl, { ...deps, fetcher }),
    accountsApi: (deps) => accountsApi(options.gatewayUrl, { ...deps, fetcher }),
    transport: syncTransport({ url: gatewaySyncUrl(options.gatewayUrl), clock: systemClock }),
    locks: soleDevice,
    hints: () => syncHints(undefined),
    clock: systemClock,
    storage,
    visibility: { current: () => 'visible', onChange: () => () => {} },
    // A seed client shows no frame to offer a newer build in.
    servedBuild: { watch: () => () => {} },
    // Nor does it copy an invitation's link: it accepts the invitation itself.
    clipboard: {
      write: () =>
        errAsync({ code: 'clipboard:UNAVAILABLE', message: 'a seed client has no clipboard' }),
    },
    logger: options.logger ?? silent,
    onError: (error) => failures.push(error),
    onSyncState: () => {},
  })

  return start.opened
    .mapErr(({ error }) => error)
    .map(() => seedClient(start.services, failures, options.inbox, storage))
}

/** The starts of `service`, keeping a start under the sign-in current in `storage`. */
function seedStarts(service: AccountStartService, storage: KeyValueStorage): SeedStarts {
  return {
    keepAfterPull: (user, from) => {
      const signIn = savedSession(storage)?.signIn

      return signIn === undefined
        ? err(dataError('data:AUTH_FAILED', 'nobody is signed in on the seed client'))
        : service.keepAfterPull(signIn, user, from)
    },
    resumeAfterPull: (user) => service.resumeAfterPull(user),
  }
}
