import { randomUUID } from 'node:crypto'

import { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import { type IdentityId, verificationIdFactory } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import { writing } from '../device-session-rows'
import emailChangeAskStatement from '../surql/email-change-ask.surql'
import emailChangeCancelStatement from '../surql/email-change-cancel.surql'
import emailChangeClaimStatement from '../surql/email-change-claim.surql'
import identityEmailMoveStatement from '../surql/identity-email-move.surql'

import { type ChangeClaims, changeKey, readChangeToken, signChangeToken } from './change-token'

/** How long a confirmation link changes the email after it was asked: a day. */
export const CONFIRMATION_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000

/** What the token of a confirmation link reads as: a pending change, one past its lifetime, or nothing. */
export type ChangeRead =
  | { readonly kind: 'change'; readonly claims: ChangeClaims }
  | { readonly kind: 'expired' }
  | { readonly kind: 'invalid' }

export interface EmailChangesOptions {
  /** The directory, where an identity's pending change and its email live. */
  readonly directory: LocalDb
  /** Better Auth's secret, from which the key of the confirmation tokens is derived. */
  readonly secret: string
  /** When a change is asked, and when its link expires. */
  readonly clock: Clock
}

/**
 * The changes of an account's email. A change is asked with the account's current email and the
 * new one: its token, signed with a key derived from the auth secret, names both, and the
 * identity keeps one pending change in `verification` (the identifier `change-email:<identity
 * key>`, the token's `jti` as its value), so a newer change replaces an earlier one and the
 * earlier link changes nothing. Its link is spent once: a claim deletes the pending change it
 * names, so of two claims at once one finds it gone. A change of the password ends the pending
 * change (`cancel`). The token's own lifetime is a day on the gateway's clock. Nothing here logs,
 * and no error names an email or a token.
 */
export class EmailChanges {
  readonly #directory: LocalDb
  readonly #key: string
  readonly #clock: Clock

  constructor(options: EmailChangesOptions) {
    this.#directory = options.directory
    this.#key = changeKey(options.secret)
    this.#clock = options.clock
  }

  /**
   * Keeps a change of `identity`'s email from `email` to `newEmail` (both in lower case) as its
   * pending one, replacing any earlier one, and answers the token of its link.
   */
  ask(identity: IdentityId, email: string, newEmail: string): ResultAsync<string, DataError> {
    const at = this.#clock.now()
    const claims: ChangeClaims = {
      purpose: 'change-email',
      identity,
      email,
      newEmail,
      jti: randomUUID(),
      at,
    }

    return writing(
      this.#directory.db
        .query(emailChangeAskStatement, {
          identity,
          id: verificationIdFactory.create(),
          jti: claims.jti,
          expires_at: new Date(at + CONFIRMATION_LINK_LIFETIME_MS),
        })
        .retry(),
      `the change of the email of ${identity} could not be kept`,
    ).andThen(() => ResultAsync.fromSafePromise(signChangeToken(claims, this.#key)))
  }

  /** Ends the pending change of `identity`'s email, if any: its link changes nothing any more. */
  cancel(identity: IdentityId): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db.query(emailChangeCancelStatement, { identity }).retry(),
      `the change of the email of ${identity} could not be ended`,
    ).map(() => undefined)
  }

  /**
   * What `token` reads as: the change it names, `expired` once a day has passed since it was
   * asked, `invalid` for a token the gateway did not sign as a confirmation token. Whether the
   * change is still pending is for `claim`.
   */
  read(token: string): ResultAsync<ChangeRead, never> {
    return ResultAsync.fromSafePromise(readChangeToken(token, this.#key)).map(
      (claims): ChangeRead => {
        if (claims === undefined) {
          return { kind: 'invalid' }
        }

        return claims.at + CONFIRMATION_LINK_LIFETIME_MS <= this.#clock.now()
          ? { kind: 'expired' }
          : { kind: 'change', claims }
      },
    )
  }

  /**
   * Spends the pending change `claims` names: true when it was pending and is spent now, false
   * when it was not (used before, replaced by a newer change, or ended by a change of the
   * password).
   */
  claim(claims: ChangeClaims): ResultAsync<boolean, DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(emailChangeClaimStatement, {
          identity: claims.identity,
          jti: claims.jti,
        })
        .retry(),
      `the change of the email of ${claims.identity} could not be spent`,
    ).map(([deleted]) => Array.isArray(deleted) && deleted.length > 0)
  }

  /**
   * Makes `to` the email of `identity` when its email is still `from`: true once it is, false when
   * the identity is gone or its email changed meanwhile.
   */
  move(identity: IdentityId, from: string, to: string): ResultAsync<boolean, DataError> {
    return writing(
      this.#directory.db
        .query<[unknown]>(identityEmailMoveStatement, { identity, from, to })
        .retry(),
      `the email of ${identity} could not be changed`,
    ).map(([moved]) => typeof moved === 'string')
  }
}
