/**
 * The gateway's auth as the device calls it, the port the client (`gatewayAuth`) implements and
 * the session and its tests depend on.
 */

import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import type { ResultAsync } from 'neverthrow'

import type { CodeStep, DataError, SignInInput, SignUpInput } from '@workspace/data'

import type { DeletedAccount } from './account-deletion'
import type { EmailConfirmation } from './email-confirmation'
import type { PasskeyOptions } from './passkey-sign-in'
import type { PasswordReset } from './password-reset'
import type { NamedDevice, SignInAnswer, StepAnswer } from './signed-in'
import type { EmailVerification } from './verification'

/**
 * The code step of a sign-in: what its password step answered, the code typed, and the
 * confirmation of the limit of devices.
 */
export interface CodeConfirmation extends CodeStep {
  readonly code: string
  readonly signOutOldest: boolean
}

/**
 * The passkey sign-in's second half: the browser's assertion, the challenge of the options it
 * answered, and the account whose limit of devices was confirmed.
 */
export interface PasskeyAssertion {
  readonly response: AuthenticationResponseJSON
  readonly challenge: string
  readonly signOutOldestFor?: string
}

export interface GatewayAuth {
  /**
   * Creates the account and has its verification mail sent; nothing is signed in, so no device is
   * named. An email that has an account answers alike, and sends nothing. A sign-up the gateway
   * refuses for what it carries fails as `data:SIGN_UP_REJECTED`, a request to wait as
   * `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`, and any other answer as
   * `data:AUTH_FAILED` naming its status, never the email or the password.
   */
  signUp(input: SignUpInput): ResultAsync<void, DataError>
  /**
   * Signs `device` in (`signed-in`); an account whose second factor is on answers the challenge
   * its code step carries (`code-required`), signing nothing in. An account whose email is not
   * verified yet fails as `data:EMAIL_NOT_VERIFIED` (exactly a 403 whose body names
   * `EMAIL_NOT_VERIFIED`), one an operator banned, once its password is right, as
   * `data:ACCOUNT_BANNED` (a 403 that names `account-banned`); one signed in on as many devices as
   * it may be answers `device-limit`, nothing signed in, unless `input.signOutOldest` confirms
   * signing out its device seen least recently. A refusal the gateway sends with no code named
   * here (a 403 `INVALID_ORIGIN` of the origin check, say) fails as `data:AUTH_FAILED` naming its
   * status.
   */
  signIn(input: SignInInput, device: NamedDevice): ResultAsync<SignInAnswer, DataError>
  /**
   * The code step of a sign-in whose password step answered `code-required`, naming `device`:
   * `signed-in`, or `device-limit` (nothing signed in; confirmed with `signOutOldest`, which the
   * gateway takes from the password again). A wrong code fails as `data:INVALID_CODE`, a challenge
   * that is dead as `data:CODE_EXPIRED`, a banned account as `data:ACCOUNT_BANNED`, an email whose
   * failed sign-ins are spent as `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`,
   * and any other answer as `data:AUTH_FAILED` naming its status, never a code.
   */
  confirmSignIn(step: CodeConfirmation, device: NamedDevice): ResultAsync<StepAnswer, DataError>
  /**
   * The first half of a passkey sign-in, with no session: the options the browser's window takes
   * and the challenge that goes back with its assertion; any failure is `data:AUTH_FAILED`
   * naming its status, an unreachable gateway `data:OFFLINE`.
   */
  passkeyOptions(device: NamedDevice): ResultAsync<PasskeyOptions, DataError>
  /**
   * The second half, naming `device`: `signed-in`, or `device-limit` with the account it asked
   * about (`consentFor`), nothing signed in. A passkey no account holds fails as
   * `data:PASSKEY_UNKNOWN`, a banned account as `data:ACCOUNT_BANNED`, and any other answer as
   * `data:AUTH_FAILED` naming its status, never the assertion.
   */
  signInWithPasskey(
    input: PasskeyAssertion,
    device: NamedDevice,
  ): ResultAsync<StepAnswer, DataError>
  /**
   * Exchanges a verification link's `token`, naming `device`: the first exchange verifies the
   * email and signs the device in (`signed-in`, with the account's name and language), a later one
   * signs nothing in (`verified-before`). The link of an account an operator banned verifies its
   * email, signs nothing in and fails as `data:ACCOUNT_BANNED` (a 403 that names `account-banned`).
   * A link past its lifetime fails as `data:LINK_EXPIRED`, any other the gateway refuses (an empty token too, without asking it) as `data:LINK_INVALID`,
   * a request to wait as `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`, and any
   * other answer as `data:AUTH_FAILED` naming its status, never a token.
   */
  verifyEmail(token: string, device: NamedDevice): ResultAsync<EmailVerification, DataError>
  /**
   * Asks the gateway to send the verification mail of `email` again. It answers alike whether
   * the email has an account not verified yet, a verified one or none; a request to wait fails as
   * `data:RATE_LIMITED`, another refusal as `data:WRITE_REJECTED`, one the gateway could not
   * complete as `data:WRITE_FAILED`, and an unreachable gateway as `data:OFFLINE`, never naming
   * the email.
   */
  resendVerification(email: string): ResultAsync<void, DataError>
  /**
   * Asks the gateway for the mail whose link sets a new password for the account of `email`. It
   * answers alike whether the email has an account or not; a request to wait fails as
   * `data:RATE_LIMITED`, another refusal as `data:WRITE_REJECTED`, one the gateway could not
   * complete as `data:WRITE_FAILED`, and an unreachable gateway as `data:OFFLINE`, never naming
   * the email.
   */
  requestPasswordReset(email: string): ResultAsync<void, DataError>
  /**
   * Sets `password` as the account's new one with a reset link's `token`, presenting the `session`
   * this device holds when it has one; nothing is signed in, and the gateway signs every device of
   * the account out, answering whether `session` was among them. A password that breaks the rules fails
   * as `data:PASSWORD_REJECTED` (the link still works), a link past its hour as
   * `data:LINK_EXPIRED`, any other the gateway refuses (an empty token too, without asking it) as
   * `data:LINK_INVALID`, a request to wait as `data:RATE_LIMITED`, an unreachable gateway as
   * `data:OFFLINE`, and any other answer as `data:AUTH_FAILED` naming its status, never the token
   * or the password.
   */
  resetPassword(
    token: string,
    password: string,
    session?: AccountSession,
  ): ResultAsync<PasswordReset, DataError>
  /**
   * Changes the password of the account `session` is signed in to: the gateway signs its other
   * devices out and keeps this one signed in. A wrong current password fails as
   * `data:INVALID_CREDENTIALS`, a new one that breaks the rules as `data:PASSWORD_REJECTED`, a
   * token the gateway no longer takes as `data:AUTH_FAILED`, a request to wait as
   * `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`, and any other answer as
   * `data:WRITE_FAILED` naming its status, never a password.
   */
  changePassword(
    input: { readonly currentPassword: string; readonly password: string },
    session: AccountSession,
  ): ResultAsync<void, DataError>
  /**
   * Asks to change the email of the account `session` is signed in to: the mail whose link makes
   * the change goes to the new email, and the answer is alike whether the new email has an account
   * or not. A wrong password fails as `data:INVALID_CREDENTIALS`, an email that is not one as
   * `data:EMAIL_INVALID`, and the rest as a change of the password does.
   */
  changeEmail(
    input: { readonly email: string; readonly password: string },
    session: AccountSession,
  ): ResultAsync<void, DataError>
  /**
   * Opens the link of an email confirmation, with no session: the account's email is the new one,
   * and the answer names the account and its new email; nothing is signed in. A link past its day
   * fails as `data:LINK_EXPIRED`, any other the gateway refuses (an empty token too, without asking
   * it) as `data:LINK_INVALID`, a request to wait as `data:RATE_LIMITED`, an unreachable gateway as
   * `data:OFFLINE`, and any other answer as `data:AUTH_FAILED` naming its status, never the token.
   */
  confirmEmail(token: string): ResultAsync<EmailConfirmation, DataError>
  /**
   * Asks to delete the account `session` is signed in to, confirmed by its `password`: the mail
   * whose link deletes it goes to the account's email, and nothing else changes. A wrong password
   * fails as `data:INVALID_CREDENTIALS`, an account that is the only administrator of an
   * organisation with other members as `data:LAST_ADMIN`, and the rest as a change of the
   * password does.
   */
  requestAccountDeletion(password: string, session: AccountSession): ResultAsync<void, DataError>
  /**
   * Deletes an account with the `token` of its deletion link, with no session; the gateway signs
   * every device of the account out, and the answer names the account. A link past its hour fails as
   * `data:LINK_EXPIRED`, any other the gateway refuses (an empty token too, without asking it) as
   * `data:LINK_INVALID`, an account that became the only administrator of an organisation with
   * other members as `data:LAST_ADMIN` (the link still works), a request to wait as
   * `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`, and any other answer (a 200
   * that does not name the account too) as `data:AUTH_FAILED` naming its status, never the token.
   */
  deleteAccount(token: string): ResultAsync<DeletedAccount, DataError>
  /**
   * Has the gateway sign out `token`, the session token of the device `device`. A token the
   * gateway no longer takes (it signs nobody in, or another device holds it) fails as
   * `data:AUTH_FAILED`: it is dead already. A request the gateway refuses otherwise (any other
   * 4xx) fails as `data:WRITE_REJECTED`: it will never take it. One the gateway could not
   * complete fails as `data:WRITE_FAILED`, and an unreachable gateway as `data:OFFLINE`: the
   * token may be sent again.
   */
  signOut(token: string, device: string): ResultAsync<void, DataError>
}

/** The session a change of the signed-in account is asked with: its token and the device's id. */
export interface AccountSession {
  readonly token: string
  readonly device: string
}

/** The part of `fetch` the gateway's auth uses. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>
