import { okAsync, type ResultAsync } from 'neverthrow'

import { type Command, type DataError, runCommand, type Shape } from '@workspace/data'
import { openStand, openStandTenant, type Stand, type StandOptions } from '@workspace/web/seeding'

import { SEED_EMAIL_DOMAIN } from '../catalog'

import { closing } from './closing'
import memberSweepText from './surql/member-sweep.surql'
import seededAccountsText from './surql/seeded-accounts.surql'
import seededMembersText from './surql/seeded-members.surql'
import seededTenantsText from './surql/seeded-tenants.surql'
import sweepText from './surql/sweep.surql'

export interface SweepOptions {
  /** Only the seeded accounts at these addresses; every seeded account when left out. */
  readonly emails?: readonly string[]
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
    'settings',
    'tenant',
    'membership',
    'invitation',
    '_replica_head',
    '_replica_snapshot',
    '_replica_update',
    '_replica_projected',
    '_replica_peer',
  ],
  region: 'server',
  ops: [],
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
 * Removes seeded accounts from the stand with their profiles, their settings and the server's
 * copy of their regions, the organisations they created with their databases, and their member
 * rows in the databases of organisations of others. An operator's task, run as a system user on
 * the stand rather than through the gateway; no seed client may still be connected as one of
 * these accounts.
 */
export function sweep(
  target: StandOptions,
  options: SweepOptions = {},
): ResultAsync<Swept, DataError> {
  return openStand(target).andThen((stand) => closing(stand, sweepStand(stand, target, options)))
}
