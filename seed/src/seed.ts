import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type Command, type DataError, dataError, runCommand, type Shape } from '@workspace/data'
import {
  type ClientOptions,
  openClient,
  openStand,
  openStandTenant,
  type SeedClient,
  type SeedError,
  type Stand,
  type StandOptions,
} from '@workspace/web/seeding'

import {
  accountFor,
  type Catalog,
  catalog,
  organisationFor,
  SEED_EMAIL_DOMAIN,
  type SeedMode,
  validateCatalog,
} from './catalog'
import memberSweepText from './surql/member-sweep.surql'
import seededAccountsText from './surql/seeded-accounts.surql'
import seededMembersText from './surql/seeded-members.surql'
import seededTenantsText from './surql/seeded-tenants.surql'
import sweepText from './surql/sweep.surql'

export { openStand, openStandTenant, type StandOptions } from '@workspace/web/seeding'

/** Where a seed goes: the gateway that creates the accounts, and the stand behind it for a reset. */
export interface StandTarget extends StandOptions {
  /** The gateway's address, such as `http://127.0.0.1:5181`. */
  readonly gatewayUrl: string
}

export interface SeedOptions extends StandTarget, Pick<ClientOptions, 'fetcher'> {
  readonly mode: SeedMode
  /** Sweep the stand's seed data first. */
  readonly reset?: boolean
}

export interface SweepOptions {
  /** Only the seeded accounts at these addresses; every seeded account when left out. */
  readonly emails?: readonly string[]
}

export interface SeededEntry {
  readonly id: string
  readonly email: string
  readonly profileId: string
}

export interface SeededOrganisation {
  readonly id: string
  readonly key: string
  readonly name: string
}

/** What a seed run created or found, by catalog ref. */
export interface SeedManifest {
  readonly accounts: Readonly<Record<string, SeededEntry>>
  readonly organisations: Readonly<Record<string, SeededOrganisation>>
}

/** What a sweep removed. */
export interface Swept {
  readonly accounts: number
  /** The organisations the accounts created, with their databases. */
  readonly organisations: number
}

interface SweepParams {
  readonly domain: string
  readonly emails?: readonly string[]
}

const sweepParams = [
  { name: 'domain', type: 'string' },
  { name: 'emails', type: 'option<array<string>>' },
] as const

const seededAccounts: Shape<SweepParams, readonly unknown[]> = {
  id: 'seed.seededAccounts',
  kind: 'shape',
  text: seededAccountsText,
  params: sweepParams,
  tables: ['identity'],
}

const seededTenants: Shape<SweepParams, readonly string[]> = {
  id: 'seed.seededTenants',
  kind: 'shape',
  text: seededTenantsText,
  params: sweepParams,
  tables: ['identity', 'tenant'],
}

/** A seeded account's member row in the database of an organisation it did not create. */
interface SeededMember {
  /** The account's key: the row is `member:<key>`. */
  readonly identity: string
  readonly database: string
}

const seededMembers: Shape<SweepParams, readonly SeededMember[]> = {
  id: 'seed.seededMembers',
  kind: 'shape',
  text: seededMembersText,
  params: sweepParams,
  tables: ['identity', 'tenant', 'membership'],
}

interface MemberSweepParams {
  readonly identities: readonly string[]
}

const memberSweep: Command<MemberSweepParams> = {
  id: 'seed.memberSweep',
  kind: 'command',
  text: memberSweepText,
  params: [{ name: 'identities', type: 'array<string>' }],
  tables: ['member'],
  region: 'server',
  ops: [],
}

const sweepCommand: Command<SweepParams> = {
  id: 'seed.sweep',
  kind: 'command',
  text: sweepText,
  params: sweepParams,
  tables: [
    'identity',
    'profile',
    'tenant',
    'membership',
    '_replica_head',
    '_replica_snapshot',
    '_replica_update',
    '_replica_projected',
    '_replica_peer',
  ],
  region: 'server',
  ops: [],
}

/** Runs the work, then closes what it ran on whatever the outcome. */
function closing<T, E>(
  opened: { close(): Promise<void> },
  work: ResultAsync<T, E>,
): ResultAsync<T, E> {
  const settled = async () => {
    const result = await work

    await opened.close()

    return result
  }

  return new ResultAsync(settled())
}

/** Removes the member rows `members` from their organisations' databases, one database at a time. */
function sweepMembers(
  target: StandOptions,
  members: readonly SeededMember[],
): ResultAsync<void, DataError> {
  const databases = [...new Set(members.map((member) => member.database))]

  return databases.reduce<ResultAsync<void, DataError>>(
    (done, database) =>
      done.andThen(() =>
        openStandTenant(target, database).andThen((tenant) =>
          closing(
            tenant,
            runCommand(tenant.local, memberSweep, {
              identities: members
                .filter((member) => member.database === database)
                .map((member) => member.identity),
            }),
          ),
        ),
      ),
    okAsync(undefined),
  )
}

function sweepStand(
  stand: Stand,
  target: StandOptions,
  options: SweepOptions,
): ResultAsync<Swept, DataError> {
  const params: SweepParams = options.emails
    ? { domain: SEED_EMAIL_DOMAIN, emails: options.emails }
    : { domain: SEED_EMAIL_DOMAIN }

  // The member rows first: a sweep that fails after them still finds the memberships next time.
  return stand.runner.read(seededAccounts, params).andThen((accounts) =>
    stand.runner.read(seededTenants, params).andThen((databases) =>
      stand.runner
        .read(seededMembers, params)
        .andThen((members) => sweepMembers(target, members))
        .andThen(() => runCommand(stand.local, sweepCommand, params))
        .map(() => ({ accounts: accounts.length, organisations: databases.length })),
    ),
  )
}

/**
 * Removes seeded accounts from the stand with their profiles and the server's copy of their
 * regions, the organisations they created with their databases, and their member rows in the
 * databases of organisations of others. An operator's task, run as a system user on the stand
 * rather than through the gateway; no seed client may still be connected as one of these accounts.
 */
export function sweep(
  target: StandOptions,
  options: SweepOptions = {},
): ResultAsync<Swept, DataError> {
  return openStand(target).andThen((stand) => closing(stand, sweepStand(stand, target, options)))
}

function seedAccounts(
  client: SeedClient,
  seeded: Catalog,
  mode: SeedMode,
): ResultAsync<Record<string, SeededEntry>, SeedError> {
  return seeded.accounts.reduce<ResultAsync<Record<string, SeededEntry>, SeedError>>(
    (done, preset) =>
      done.andThen((accounts) => {
        const account = accountFor(preset, mode)

        return client.ensureAccount(account).map((seeded) => ({
          ...accounts,
          [preset.ref]: { id: seeded.user.id, email: account.email, profileId: seeded.profileId },
        }))
      }),
    okAsync({}),
  )
}

/** Each organisation of the catalog: its administrator signs in, creates it and invites its members. */
function seedOrganisations(
  client: SeedClient,
  seeded: Catalog,
  mode: SeedMode,
): ResultAsync<Record<string, SeededOrganisation>, SeedError> {
  return seeded.organisations.reduce<ResultAsync<Record<string, SeededOrganisation>, SeedError>>(
    (done, preset) =>
      done.andThen((organisations) => {
        const admin = seeded.accounts.find((account) => account.ref === preset.admin)
        const organisation = organisationFor(preset, mode)

        if (!admin) {
          return errAsync(dataError('data:QUERY_FAILED', `no account ${preset.admin}`))
        }

        return client
          .signIn(accountFor(admin, mode))
          .andThen(() => client.ensureOrganisation(organisation))
          .andThen((membership) =>
            preset.members
              .reduce<ResultAsync<void, SeedError>>(
                (invited, ref) =>
                  invited.andThen(() => {
                    const member = seeded.accounts.find((account) => account.ref === ref)

                    return member
                      ? client.ensureMember(organisation.key, accountFor(member, mode).email)
                      : errAsync(dataError('data:QUERY_FAILED', `no account ${ref}`))
                  }),
                okAsync(undefined),
              )
              .map(() => ({
                ...organisations,
                [preset.ref]: {
                  id: membership.tenant.id,
                  key: membership.tenant.key,
                  name: membership.tenant.name,
                },
              })),
          )
      }),
    okAsync({}),
  )
}

/**
 * Seeds the catalog's accounts through the gateway as a device would, one account at a time,
 * then its organisations, whose administrators invite the members (so every account exists
 * first). With `reset`, the stand's seed data is swept first. A catalog the run would not hold
 * (an organisation key the run's suffix makes too long, among others) is refused before anything.
 */
export function runSeed(options: SeedOptions): ResultAsync<SeedManifest, SeedError> {
  const { mode, reset, gatewayUrl, fetcher, ...stand } = options
  const checked = validateCatalog(catalog, mode)

  if (checked.isErr()) {
    return errAsync(
      dataError('data:QUERY_FAILED', `the seed catalog is refused: ${checked.error.join('; ')}`),
    )
  }

  const seeded = checked.value

  return (reset ? sweep(stand).map(() => undefined) : okAsync(undefined))
    .andThen(() => openClient(fetcher ? { gatewayUrl, fetcher } : { gatewayUrl }))
    .andThen((client) =>
      closing(
        client,
        seedAccounts(client, seeded, mode).andThen((accounts) =>
          seedOrganisations(client, seeded, mode).map((organisations) => ({
            accounts,
            organisations,
          })),
        ),
      ),
    )
}
