import { okAsync, ResultAsync } from 'neverthrow'

import { type Command, type DataError, runCommand, type Shape } from '@workspace/data'
import {
  openClient,
  openStand,
  type SeedClient,
  type SeedError,
  type Stand,
  type StandOptions,
} from '@workspace/web/seeding'

import { accountFor, catalog, SEED_EMAIL_DOMAIN, type SeedMode } from './catalog'
import seededAccountsText from './surql/seeded-accounts.surql'
import sweepText from './surql/sweep.surql'

export { openStand, type StandOptions } from '@workspace/web/seeding'

/** Where a seed goes: the gateway that creates the accounts, and the stand behind it for a reset. */
export interface StandTarget extends StandOptions {
  /** The gateway's address, such as `http://127.0.0.1:5181`. */
  readonly gatewayUrl: string
}

export interface SeedOptions extends StandTarget {
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

/** What a seed run created or found, by catalog ref. */
export interface SeedManifest {
  readonly accounts: Readonly<Record<string, SeededEntry>>
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

const sweepCommand: Command<SweepParams> = {
  id: 'seed.sweep',
  kind: 'command',
  text: sweepText,
  params: sweepParams,
  tables: [
    'identity',
    'profile',
    '_replica_head',
    '_replica_snapshot',
    '_replica_update',
    '_replica_projected',
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

function sweepStand(
  stand: Stand,
  options: SweepOptions,
): ResultAsync<{ accounts: number }, DataError> {
  const params: SweepParams = options.emails
    ? { domain: SEED_EMAIL_DOMAIN, emails: options.emails }
    : { domain: SEED_EMAIL_DOMAIN }

  return stand.runner
    .read(seededAccounts, params)
    .andThen((accounts) =>
      runCommand(stand.local, sweepCommand, params).map(() => ({ accounts: accounts.length })),
    )
}

/**
 * Removes seeded accounts from the stand with their profiles and the server's copy of their
 * regions. An operator's task, run as a system user on the stand rather than through the
 * gateway; no seed client may still be connected as one of these accounts.
 */
export function sweep(
  target: StandOptions,
  options: SweepOptions = {},
): ResultAsync<{ accounts: number }, DataError> {
  return openStand(target).andThen((stand) => closing(stand, sweepStand(stand, options)))
}

function seedAccounts(client: SeedClient, mode: SeedMode): ResultAsync<SeedManifest, SeedError> {
  return catalog.accounts
    .reduce<ResultAsync<Record<string, SeededEntry>, SeedError>>(
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
    .map((accounts) => ({ accounts }))
}

/**
 * Seeds the catalog's accounts through the gateway as a device would, one account at a time.
 * With `reset`, the stand's seed data is swept first.
 */
export function runSeed(options: SeedOptions): ResultAsync<SeedManifest, SeedError> {
  const { mode, reset, gatewayUrl, ...stand } = options

  return (reset ? sweep(stand).map(() => undefined) : okAsync(undefined))
    .andThen(() => openClient({ gatewayUrl }))
    .andThen((client) => closing(client, seedAccounts(client, mode)))
}
