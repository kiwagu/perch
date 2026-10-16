import { okAsync, ResultAsync } from 'neverthrow'

import { type Command, type DataError, runCommand, type Shape } from '@workspace/data'
import {
  openStand as openAppStand,
  type SeedError,
  type Stand,
  type StandOptions,
} from '@workspace/web/seeding'

import { accountFor, catalog, SEED_EMAIL_DOMAIN, type SeedMode } from './catalog'
import seededAccountsText from './surql/seeded-accounts.surql'
import sweepText from './surql/sweep.surql'

/** The stand to seed: its address, namespace and database, and a system user. */
export type StandTarget = Omit<StandOptions, 'logger'>

export interface SeedOptions extends StandTarget {
  readonly mode: SeedMode
  /** Sweep the stand's seed data first. */
  readonly reset?: boolean
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

const seededAccounts: Shape<{ domain: string }, readonly unknown[]> = {
  id: 'seed.seededAccounts',
  kind: 'shape',
  text: seededAccountsText,
  params: [{ name: 'domain', type: 'string' }],
  tables: ['identity'],
}

const sweepCommand: Command<{ domain: string }> = {
  id: 'seed.sweep',
  kind: 'command',
  text: sweepText,
  params: [{ name: 'domain', type: 'string' }],
  tables: ['identity', 'profile', '_replica_snapshot', '_replica_update', '_replica_outbox'],
  region: 'server',
  ops: [],
}

export const openStand = (target: StandTarget): ResultAsync<Stand, DataError> =>
  openAppStand(target)

/** Runs the work, then closes the stand whatever the outcome. */
function closing<T, E>(stand: Stand, work: ResultAsync<T, E>): ResultAsync<T, E> {
  const settled = async () => {
    const result = await work

    await stand.close()

    return result
  }

  return new ResultAsync(settled())
}

function sweepStand(stand: Stand): ResultAsync<{ accounts: number }, DataError> {
  const domain = SEED_EMAIL_DOMAIN

  return stand.runner
    .read(seededAccounts, { domain })
    .andThen((accounts) =>
      runCommand(stand.local, sweepCommand, { domain }).map(() => ({ accounts: accounts.length })),
    )
}

/** Removes every seeded account from the stand, with its profile and region documents. */
export function sweep(target: StandTarget): ResultAsync<{ accounts: number }, DataError> {
  return openStand(target).andThen((stand) => closing(stand, sweepStand(stand)))
}

/** Seeds the catalog's accounts through the product path, one account at a time. */
export function runSeed(options: SeedOptions): ResultAsync<SeedManifest, SeedError> {
  const { mode, reset, ...target } = options

  return openStand(target).andThen((stand) =>
    closing(
      stand,
      (reset ? sweepStand(stand).map(() => undefined) : okAsync(undefined))
        .andThen(() =>
          catalog.accounts.reduce<ResultAsync<Record<string, SeededEntry>, SeedError>>(
            (done, preset) =>
              done.andThen((accounts) => {
                const account = accountFor(preset, mode)

                return stand.ensureAccount(account).map((seeded) => ({
                  ...accounts,
                  [preset.ref]: {
                    id: seeded.user.id,
                    email: account.email,
                    profileId: seeded.profileId,
                  },
                }))
              }),
            okAsync({}),
          ),
        )
        .map((accounts) => ({ accounts })),
    ),
  )
}
