import { isAPIError } from 'better-auth/api'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import type { AuthInstance } from './auth-instance'
import { writing } from './device-session-rows'
import { hashPassword } from './password-hash'
import accountPasswordSetStatement from './surql/account-password-set.surql'

/** What a change of a password did: changed it, or found the current password wrong. */
export type PasswordChange = 'changed' | 'wrong-password'

/** What a request for a reset mail did: asked for it, or was refused (not an email). */
export type ResetRequest = 'asked' | 'refused'

/** Better Auth's code on a refusal it threw, if the failure is one. */
function refusalCode(cause: unknown): string | undefined {
  if (!isAPIError(cause)) {
    return undefined
  }

  const { code } = cause.body ?? {}

  return typeof code === 'string' ? code : undefined
}

/** The headers of a call with the raw session token `token`. */
const bearer = (token: string): Headers => new Headers({ authorization: `Bearer ${token}` })

export interface AccountPasswordsOptions {
  /** Better Auth, whose own endpoints are called on the server. */
  readonly auth: AuthInstance
  /** The directory, where a reset's new password is written on the credential row. */
  readonly directory: LocalDb
}

/**
 * The passwords of accounts: a request for a reset mail, the change of a signed-in account's
 * password and the check of its current password through Better Auth's own endpoints called on
 * the server (`auth.api`), and the password a reset link sets, written by the gateway. None of
 * Better Auth's endpoints of a password is served over HTTP: the auth mount answers those paths
 * itself, and the change is called with no `revokeOtherSessions`, so Better Auth never ends
 * sessions by its bulk delete; the gateway ends them itself. Better Auth's own reset is not used:
 * it spends the link inside a transaction through a call SurrealDB's adapter does not have, so
 * the gateway spends the link (`ResetLinks.claim`) and sets the password with the same hash
 * (`set`). A refusal that is not one of these answers, or a failure, is a `DataError` that names
 * nothing of the password, the token or the email.
 */
export class AccountPasswords {
  readonly #auth: AuthInstance
  readonly #directory: LocalDb

  constructor(options: AccountPasswordsOptions) {
    this.#auth = options.auth
    this.#directory = options.directory
  }

  /**
   * Asks Better Auth for a reset mail to `email`: for an email that has an account it keeps a
   * new link and starts the mail; for one that has none it does nothing, in about the same time.
   * `refused` when the email is not an email.
   */
  requestReset(email: string): ResultAsync<ResetRequest, DataError> {
    return this.#ask(
      () => this.#auth.api.requestPasswordReset({ body: { email } }),
      (code) => (code === 'VALIDATION_ERROR' ? 'refused' : undefined),
      'asked',
      'a reset mail could not be asked for',
    )
  }

  /**
   * Sets `password` as the password of `identity`, hashed as Better Auth hashes one, on its
   * credential row; fails when the identity has none. The caller holds it to the rules of a new
   * password first.
   */
  set(identity: IdentityId, password: string): ResultAsync<void, DataError> {
    return ResultAsync.fromPromise(hashPassword(password), () =>
      dataError('data:WRITE_FAILED', 'a password could not be hashed'),
    )
      .andThen((hash) =>
        writing(
          this.#directory.db
            .query<[unknown]>(accountPasswordSetStatement, { identity, hash })
            .retry(),
          `the password of ${identity} could not be set`,
        ),
      )
      .andThen(([rows]) =>
        Array.isArray(rows) && rows.length > 0
          ? okAsync(undefined)
          : errAsync(dataError('data:WRITE_FAILED', `${identity} has no password to set`)),
      )
  }

  /**
   * Changes the password of the account whose live session holds `token` from `current` to
   * `password`: `wrong-password` when `current` is not its password. No session ends here.
   */
  change(token: string, current: string, password: string): ResultAsync<PasswordChange, DataError> {
    return this.#ask(
      () =>
        this.#auth.api.changePassword({
          body: { currentPassword: current, newPassword: password },
          headers: bearer(token),
        }),
      (code) => (code === 'INVALID_PASSWORD' ? 'wrong-password' : undefined),
      'changed',
      'a password could not be changed',
    )
  }

  /** Whether `password` is the password of the account whose live session holds `token`. */
  matches(token: string, password: string): ResultAsync<boolean, DataError> {
    return this.#ask(
      () => this.#auth.api.verifyPassword({ body: { password }, headers: bearer(token) }),
      (code) => (code === 'INVALID_PASSWORD' ? false : undefined),
      true,
      'a password could not be checked',
    )
  }

  /**
   * Runs `call`: `done` when it answers, what `refusal` makes of the code of a refusal it throws,
   * else a failure with `message` alone (Better Auth's words and cause stay out of it).
   */
  #ask<T>(
    call: () => Promise<unknown>,
    refusal: (code: string | undefined) => T | undefined,
    done: T,
    message: string,
  ): ResultAsync<T, DataError> {
    return ResultAsync.fromPromise(
      call().then(
        () => done,
        (cause: unknown) => {
          const answer = refusal(refusalCode(cause))

          if (answer === undefined) {
            throw cause
          }

          return answer
        },
      ),
      () => dataError('data:WRITE_FAILED', message),
    )
  }
}
