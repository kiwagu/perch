import { randomUUID } from 'node:crypto'

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type IdentityId, verificationIdFactory } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import { writing } from '../device-session-rows'
import accountDeletionAskStatement from '../surql/account-deletion-ask.surql'
import accountDeletionCancelStatement from '../surql/account-deletion-cancel.surql'
import accountDeletionClaimStatement from '../surql/account-deletion-claim.surql'

import {
  type DeletionClaims,
  deletionKey,
  readDeletionToken,
  signDeletionToken,
} from './deletion-token'

/**
 * What `account-deletion-claim.surql` answers: the rows it deleted, none when no deletion of the
 * identity was pending under the link. A row needs to be a row, nothing more: its values are not
 * read.
 */
const deletedRows = z.array(z.object({}))

/** How long a deletion link deletes the account after it was asked: an hour. */
export const DELETION_LINK_LIFETIME_MS = 60 * 60 * 1000

/** What the token of a deletion link reads as: a pending deletion, one past its lifetime, or nothing. */
export type DeletionRead =
  | { readonly kind: 'deletion'; readonly claims: DeletionClaims }
  | { readonly kind: 'expired' }
  | { readonly kind: 'invalid' }

export interface AccountDeletionsOptions {
  /** The directory, where an identity's pending deletion lives. */
  readonly directory: LocalDb
  /** Better Auth's secret, from which the key of the deletion tokens is derived. */
  readonly secret: string
  /** When a deletion is asked, and when its link expires. */
  readonly clock: Clock
}

/**
 * The deletions of an account. A deletion is asked for the identity: its token, signed with a key
 * derived from the auth secret, names the identity, and the identity keeps one pending deletion
 * in `verification` (the identifier `delete-account:<identity key>`, the token's `jti` as its
 * value), so a newer deletion replaces an earlier one and the earlier link deletes nothing. Its
 * link is spent once: a claim deletes the pending deletion it names, so of two claims at once one
 * finds it gone. A change of the password or of the email ends the pending deletion (their own
 * transactions do), and `cancel` ends it on its own. The token's own lifetime is an hour on the
 * gateway's clock. Nothing here logs, and no error names a token.
 */
export class AccountDeletions {
  readonly #directory: LocalDb
  readonly #key: string
  readonly #clock: Clock

  constructor(options: AccountDeletionsOptions) {
    this.#directory = options.directory
    this.#key = deletionKey(options.secret)
    this.#clock = options.clock
  }

  /**
   * Keeps a deletion of `identity`'s account as its pending one, replacing any earlier one, and
   * answers the token of its link.
   */
  ask(identity: IdentityId): ResultAsync<string, DataError> {
    const at = this.#clock.now()
    const claims: DeletionClaims = {
      purpose: 'delete-account',
      identity,
      jti: randomUUID(),
      at,
    }

    return writing(
      this.#directory.db
        .query(accountDeletionAskStatement, {
          identity,
          id: verificationIdFactory.create(),
          jti: claims.jti,
          expires_at: new Date(at + DELETION_LINK_LIFETIME_MS),
        })
        .retry(),
      `the deletion of the account of ${identity} could not be kept`,
    ).andThen(() => ResultAsync.fromSafePromise(signDeletionToken(claims, this.#key)))
  }

  /** Ends the pending deletion of `identity`'s account, if any: its link deletes nothing any more. */
  cancel(identity: IdentityId): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db.query(accountDeletionCancelStatement, { identity }).retry(),
      `the deletion of the account of ${identity} could not be ended`,
    ).map(() => undefined)
  }

  /**
   * What `token` reads as: the deletion it names, `expired` once an hour has passed since it was
   * asked, `invalid` for a token the gateway did not sign as a deletion token. Whether the
   * deletion is still pending is for `claim`.
   */
  read(token: string): ResultAsync<DeletionRead, never> {
    return ResultAsync.fromSafePromise(readDeletionToken(token, this.#key)).map(
      (claims): DeletionRead => {
        if (claims === undefined) {
          return { kind: 'invalid' }
        }

        return claims.at + DELETION_LINK_LIFETIME_MS <= this.#clock.now()
          ? { kind: 'expired' }
          : { kind: 'deletion', claims }
      },
    )
  }

  /**
   * Spends the pending deletion `claims` names: true when it was pending and is spent now, false
   * when it was not (used before, replaced by a newer deletion, or ended by a change of the
   * password or of the email) or its hour has passed on the gateway's clock, however late the
   * claim comes. An answer of the directory that is not a list of rows is an error, never a link
   * that deletes nothing.
   */
  claim(claims: DeletionClaims): ResultAsync<boolean, DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(accountDeletionClaimStatement, {
          identity: claims.identity,
          jti: claims.jti,
          now: new Date(this.#clock.now()),
        })
        .retry(),
      `the deletion of the account of ${claims.identity} could not be spent`,
    ).andThen(([deleted]) => {
      const rows = deletedRows.safeParse(deleted)

      return rows.success
        ? okAsync<boolean, DataError>(rows.data.length > 0)
        : errAsync<boolean, DataError>(
            dataError(
              'data:QUERY_FAILED',
              'the answer to the spending of a deletion of an account has an unknown shape',
            ),
          )
    })
  }
}
