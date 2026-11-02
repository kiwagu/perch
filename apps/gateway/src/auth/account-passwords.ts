import { isAPIError } from 'better-auth/api'
import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import type { DeviceSessionId, IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { AuthInstance } from './auth-instance'
import { toEndedDevices } from './auth-sessions'
import { reading, writing } from './device-session-rows'
import { hashPassword, verifyPassword } from './password-hash'
import accountPasswordStatement from './surql/account-password.surql'
import passwordChangeCommitStatement from './surql/password-change-commit.surql'
import passwordResetCommitStatement from './surql/password-reset-commit.surql'

/** What a reset with a link did: set the password, or found the link unknown or past its hour. */
export type PasswordReset = 'reset' | 'link-invalid' | 'link-expired'

/**
 * What a change of a password did: changed it, ending the sessions of `devices` (each device
 * whose session was live until then), or changed nothing because the current password is wrong or
 * the caller's session is no longer live.
 */
export type PasswordChange =
  | { readonly kind: 'changed'; readonly devices: readonly string[] }
  | { readonly kind: 'wrong-password' }
  | { readonly kind: 'unauthorized' }

/** What a request for a reset mail did: asked for it, or was refused (not an email). */
export type ResetRequest = 'asked' | 'refused'

const resetOutcome = z.enum(['reset', 'link-invalid', 'link-expired'])
const changeOutcome = z.object({
  outcome: z.enum(['changed', 'wrong-password', 'unauthorized']),
  ended: z.unknown(),
})
const storedHash = z.string().min(1)

/** Better Auth's code on a refusal it threw, if the failure is one. */
function refusalCode(cause: unknown): string | undefined {
  if (!isAPIError(cause)) {
    return undefined
  }

  const { code } = cause.body ?? {}

  return typeof code === 'string' ? code : undefined
}

/** What a transaction answered: the value its `RETURN` gave, second to last after the COMMIT. */
const returned = (results: readonly unknown[]): unknown => results.at(-2)

/** A password hashed as Better Auth hashes one; a failure names nothing of it. */
const hashed = (password: string): ResultAsync<string, DataError> =>
  ResultAsync.fromPromise(hashPassword(password), () =>
    dataError('data:WRITE_FAILED', 'a password could not be hashed'),
  )

export interface AccountPasswordsOptions {
  /** Better Auth, which keeps a new reset link and starts its mail. */
  readonly auth: AuthInstance
  /** The directory, where a password, its sessions and its links change together. */
  readonly directory: LocalDb
  /** When a reset link is judged expired, and when the sessions a new password ends end. */
  readonly clock: Clock
}

/**
 * The passwords of accounts. A request for a reset mail goes through Better Auth's own endpoint
 * called on the server (`auth.api`), which keeps the link and starts the mail. A reset and a change
 * are the gateway's own, each one transaction of the directory (`password-reset-commit.surql`,
 * `password-change-commit.surql`): the new password, the end of the account's sessions (every one
 * at a reset, every other one at a change), of its reset links and of its pending change of email
 * commit together or not at all, so no failure leaves a new password beside sessions or links that
 * outlive it. Each hashes the new password as Better Auth hashes one, before its transaction. A
 * failure is a `DataError` that names nothing of the password, the token or the email.
 */
export class AccountPasswords {
  readonly #auth: AuthInstance
  readonly #directory: LocalDb
  readonly #clock: Clock

  constructor(options: AccountPasswordsOptions) {
    this.#auth = options.auth
    this.#directory = options.directory
    this.#clock = options.clock
  }

  /**
   * Asks Better Auth for a reset mail to `email`: for an email that has an account it keeps a
   * new link and starts the mail; for one that has none it does nothing, in about the same time.
   * `refused` when the email is not an email.
   */
  requestReset(email: string): ResultAsync<ResetRequest, DataError> {
    return ResultAsync.fromPromise(
      this.#auth.api.requestPasswordReset({ body: { email } }).then(
        (): ResetRequest => 'asked',
        (cause: unknown): ResetRequest => {
          if (refusalCode(cause) === 'VALIDATION_ERROR') {
            return 'refused'
          }

          throw cause
        },
      ),
      () => dataError('data:WRITE_FAILED', 'a reset mail could not be asked for'),
    )
  }

  /** `password` hashed as Better Auth hashes one, ready for a reset. */
  hash(password: string): ResultAsync<string, DataError> {
    return hashed(password)
  }

  /**
   * Resets the password of `identity` to `hash` with the reset link whose token is `token`, now on
   * the clock, in one transaction: the link must still be the identity's and live now, else
   * `link-invalid` or `link-expired` and nothing changes; then every reset link of the identity
   * (this one spent with them), its password, every one of its sessions and its pending change of
   * email change together.
   */
  reset(identity: IdentityId, token: string, hash: string): ResultAsync<PasswordReset, DataError> {
    return writing(
      this.#directory.db
        .query<unknown[]>(passwordResetCommitStatement, {
          identity,
          link_token: token,
          hash,
          ended_at: new Date(this.#clock.now()),
        })
        .retry(),
      `the password of ${identity} could not be reset`,
    ).andThen((results) => {
      const outcome = resetOutcome.safeParse(returned(results))

      return outcome.success
        ? ok(outcome.data)
        : err(dataError('data:QUERY_FAILED', 'the reset of a password has an unknown shape'))
    })
  }

  /**
   * Changes the password of `identity` from `current` to `password` for its session `keep`: the
   * current password is checked against the credential row first, then, in one transaction, the
   * session must still be live and the row must still hold the hash that was checked (else
   * `unauthorized` or `wrong-password`, nothing changed), and the new password, every reset link of
   * the identity, every one of its other sessions and its pending change of email change together.
   */
  change(
    identity: IdentityId,
    keep: DeviceSessionId,
    current: string,
    password: string,
  ): ResultAsync<PasswordChange, DataError> {
    return this.#checked(identity, current).andThen((verified) =>
      verified === undefined
        ? okAsync<PasswordChange, DataError>({ kind: 'wrong-password' })
        : hashed(password).andThen((hash) => this.#commitChange(identity, keep, verified, hash)),
    )
  }

  /** Whether `password` is the password on the credential row of `identity`. */
  matches(identity: IdentityId, password: string): ResultAsync<boolean, DataError> {
    return this.#checked(identity, password).map((verified) => verified !== undefined)
  }

  /** The hash on `identity`'s credential row when `password` matches it; none when it does not. */
  #checked(identity: IdentityId, password: string): ResultAsync<string | undefined, DataError> {
    return reading(
      this.#directory.db.query<[unknown[]]>(accountPasswordStatement, { identity }),
      `the password of ${identity} could not be read`,
    ).andThen(([rows]) => {
      const hash = storedHash.safeParse(rows[0])

      return hash.success
        ? ResultAsync.fromPromise(verifyPassword({ password, hash: hash.data }), () =>
            dataError('data:QUERY_FAILED', 'a password could not be checked'),
          ).map((matches) => (matches ? hash.data : undefined))
        : okAsync(undefined)
    })
  }

  #commitChange(
    identity: IdentityId,
    keep: DeviceSessionId,
    verified: string,
    hash: string,
  ): ResultAsync<PasswordChange, DataError> {
    return writing(
      this.#directory.db
        .query<unknown[]>(passwordChangeCommitStatement, {
          identity,
          keep,
          verified_hash: verified,
          hash,
          ended_at: new Date(this.#clock.now()),
        })
        .retry(),
      `the password of ${identity} could not be changed`,
    ).andThen((results) => toPasswordChange(returned(results)))
  }
}

/** A change as its transaction answered it; its values stay out of the error. */
function toPasswordChange(value: unknown): Result<PasswordChange, DataError> {
  const answer = changeOutcome.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the change of a password has an unknown shape'))
  }

  const { outcome, ended } = answer.data

  return outcome === 'changed'
    ? toEndedDevices(ended).map((devices): PasswordChange => ({ kind: 'changed', devices }))
    : ok({ kind: outcome })
}
