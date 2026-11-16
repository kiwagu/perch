import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import { writing } from '../auth/device-session-rows'

import accountBanStatement from './surql/account-ban.surql'
import accountUnbanStatement from './surql/account-unban.surql'

export interface AccountBansOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  /** The moment a ban ends the account's sessions at. */
  readonly clock: Clock
}

/** What a ban did: the account is banned, or no account has the identity and nothing changed. */
export type BanOutcome = 'banned' | 'gone'

/** What a lift of a ban did: the account is not banned, or no account has the identity. */
export type UnbanOutcome = 'unbanned' | 'gone'

/** The value a statement in a transaction returns: the last answer but the commit's. */
const returned = (results: readonly unknown[]): unknown => fromDriverValue(results.at(-2))

/** `value` parsed by `schema`; its value is left out of the error. */
function parsed<T>(schema: z.ZodType<T>, value: unknown, what: string): Result<T, DataError> {
  const answer = schema.safeParse(value)

  return answer.success
    ? ok(answer.data)
    : err(dataError('data:QUERY_FAILED', `${what} has an unknown shape`))
}

/**
 * The bans of accounts the platform's operators set and lift, written in the directory as the
 * namespace user, each in one transaction. A ban marks the account and ends every session it has
 * not ended in the same step, so no session of it is usable once the ban committed, and a sign-in
 * or a verification waiting for its admission is refused by it (the admissions read the ban in
 * their own transactions). Closing the account's open sockets is its caller's, after the ban
 * committed. Nothing here takes an account's turn: the caller does.
 */
export class AccountBans {
  readonly #directory: LocalDb
  readonly #clock: Clock

  constructor(options: AccountBansOptions) {
    this.#directory = options.directory
    this.#clock = options.clock
  }

  /**
   * Bans the account of `identity` until an operator lifts the ban, with `reason` trimmed (none
   * when nothing is left of it), and ends every session of it not ended already, now, with
   * `banned` as its reason. An account banned already keeps its ban, with the reason given now.
   */
  ban(identity: IdentityId, reason: string | undefined): ResultAsync<BanOutcome, DataError> {
    const trimmed = reason?.trim() ?? ''

    return writing(
      this.#directory.db
        .query<unknown[]>(accountBanStatement, {
          identity,
          reason: trimmed === '' ? undefined : trimmed,
          now: new Date(this.#clock.now()),
        })
        .retry(),
      `the ban of ${identity} could not be written`,
    ).andThen((results) => parsed(z.enum(['banned', 'gone']), returned(results), 'a ban'))
  }

  /**
   * Lifts the ban of the account of `identity`, its reason with it; the sessions the ban ended
   * stay ended, and an account that was not banned stays as it is.
   */
  unban(identity: IdentityId): ResultAsync<UnbanOutcome, DataError> {
    return writing(
      this.#directory.db.query<unknown[]>(accountUnbanStatement, { identity }).retry(),
      `the ban of ${identity} could not be lifted`,
    ).andThen((results) =>
      parsed(z.enum(['unbanned', 'gone']), returned(results), 'a lift of a ban'),
    )
  }
}
