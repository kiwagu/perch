import { isAPIError } from 'better-auth/api'
import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { type DeviceSessionId, type IdentityId, idSchemas } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { z } from '@workspace/zod'

import type { AuthInstance } from './auth-instance'
import { toEndedDevices } from './auth-sessions'
import { reading, writing } from './device-session-rows'
import { hashPassword, verifyPassword } from './password-hash'
import accountPasswordStatement from './surql/account-password.surql'
import passwordChangeCommitStatement from './surql/password-change-commit.surql'
import passwordResetCommitStatement from './surql/password-reset-commit.surql'
import signInCredentialStatement from './surql/sign-in-credential.surql'

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

/** What the first device that enters an account starts it from: its sign-up's name and language. */
export interface AccountStart {
  readonly name: string
  readonly locale: Locale
}

/**
 * The account an email signs in to, and the hash on its credential row (none when it has no
 * credential row): a new password always gets a hash of its own, so the hash tells whether the
 * password changed. `banned` tells whether an operator banned the account. The read a sign-in
 * makes before the password was checked carries it, but nothing refuses on it then: a ban is
 * refused only after the password was checked (by Better Auth's gate, then by the admission), so
 * nobody without the password learns of a ban. `start` is there while the account has not
 * started: its profile or its settings have not reached the directory through its private region
 * yet.
 */
export interface SignInCredential {
  readonly identity: IdentityId
  readonly hash: string | undefined
  readonly banned: boolean
  readonly start: AccountStart | undefined
}

/**
 * Whether a sign-in stands for `identity`, the account Better Auth signed in: the two reads of
 * its email, before Better Auth checked the password and once it wrote the session, both found
 * that very account with a password, the same one. An email that had no account at either read,
 * an account without a password, another account at either read, or a password that changed in
 * between all fail it: Better Auth may then have checked a password that is no longer the
 * account's, or an account the email no longer named. The first verification of an email, which
 * signs a device in, is held to it too: a reset that gave the account a new password meanwhile
 * ended every session it found, and the verification's may not have been written yet.
 */
export function signInStands(
  before: SignInCredential | undefined,
  after: SignInCredential | undefined,
  identity: IdentityId,
): boolean {
  return (
    before !== undefined &&
    after !== undefined &&
    before.identity === identity &&
    after.identity === identity &&
    before.hash !== undefined &&
    before.hash === after.hash
  )
}

const credentialRow = z.object({
  identity: idSchemas.identity.schema,
  hash: z.string().min(1).nullish(),
  banned: z.boolean(),
  name: z.string(),
  locale: z.enum(SUPPORTED_LOCALES),
  started: z.boolean(),
})

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

  /**
   * The account `email` signs in to, in any case, the hash on its credential row, whether it is
   * banned and, while the account has not started, what it starts from; none when no account has
   * the email. A sign-in reads it before Better Auth checks the password and again once Better Auth
   * wrote the session (`signInStands`), and a verification likewise, whose second read, or its
   * read after Better Auth failed, tells a banned account's refusal from a failure.
   */
  credentialOf(email: string): ResultAsync<SignInCredential | undefined, DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(signInCredentialStatement, { email }),
      'the credential of an email could not be read',
    ).andThen(([value]) => {
      if (value === undefined || value === null) {
        return ok(undefined)
      }

      const row = credentialRow.safeParse(value)

      if (!row.success) {
        return err(
          dataError('data:QUERY_FAILED', 'the credential of an email has an unknown shape'),
        )
      }

      const { identity, hash, banned, name, locale, started } = row.data

      return ok({
        identity,
        hash: hash ?? undefined,
        banned,
        start: started ? undefined : { name, locale },
      })
    })
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
