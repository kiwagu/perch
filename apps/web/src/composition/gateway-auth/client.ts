/**
 * The gateway's auth as the device calls it: Better Auth's client for the sign-in, the gateway's
 * own answers for the sign-up, the verification of an email, its resend and the sign-out.
 */

import { createAuthClient } from 'better-auth/client'
import { errAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type SignInInput, type SignUpInput } from '@workspace/data'

import { accountChangeOf } from './account-change'
import { accountDeletedOf } from './account-deletion'
import { type EmailConfirmation, emailConfirmationOf } from './email-confirmation'
import { mailRequested } from './mail-request'
import { passwordResetOf } from './password-reset'
import { signedOutOf } from './sign-out'
import { signedUpOf } from './sign-up'
import { deviceHeaders, type NamedDevice, type SignedInDevice, signedIn } from './signed-in'
import { type EmailVerification, verificationOf } from './verification'

export interface GatewayAuth {
  /**
   * Creates the account and has its verification mail sent; nothing is signed in, so no device is
   * named. An email that has an account answers alike, and sends nothing. A sign-up the gateway
   * refuses for what it carries fails as `data:SIGN_UP_REJECTED`, a request to wait as
   * `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`, and any other answer as
   * `data:AUTH_FAILED` naming its status, never the email or the password.
   */
  signUp(input: SignUpInput): ResultAsync<void, DataError>
  /** Signs `device` in; an account whose email is not verified yet fails as `data:EMAIL_NOT_VERIFIED`. */
  signIn(input: SignInInput, device: NamedDevice): ResultAsync<SignedInDevice, DataError>
  /**
   * Exchanges a verification link's `token`, naming `device`: the first exchange verifies the
   * email and signs the device in (`signed-in`, with the account's name and language), a later one
   * signs nothing in (`verified-before`). A link past its lifetime fails as `data:LINK_EXPIRED`,
   * any other the gateway refuses (an empty token too, without asking it) as `data:LINK_INVALID`,
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
   * Sets `password` as the account's new one with a reset link's `token`; nothing is signed in,
   * and the gateway signs every device of the account out. A password that breaks the rules fails
   * as `data:PASSWORD_REJECTED` (the link still works), a link past its hour as
   * `data:LINK_EXPIRED`, any other the gateway refuses (an empty token too, without asking it) as
   * `data:LINK_INVALID`, a request to wait as `data:RATE_LIMITED`, an unreachable gateway as
   * `data:OFFLINE`, and any other answer as `data:AUTH_FAILED` naming its status, never the token
   * or the password.
   */
  resetPassword(token: string, password: string): ResultAsync<void, DataError>
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
   * every device of the account out, and the answer names nothing. A link past its hour fails as
   * `data:LINK_EXPIRED`, any other the gateway refuses (an empty token too, without asking it) as
   * `data:LINK_INVALID`, an account that became the only administrator of an organisation with
   * other members as `data:LAST_ADMIN` (the link still works), a request to wait as
   * `data:RATE_LIMITED`, an unreachable gateway as `data:OFFLINE`, and any other answer as
   * `data:AUTH_FAILED` naming its status, never the token.
   */
  deleteAccount(token: string): ResultAsync<void, DataError>
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

const offline = (cause: unknown) => dataError('data:OFFLINE', 'could not reach the gateway', cause)

/**
 * An unreachable gateway, for a request that carries a password, a link's token or an email: the
 * rejection is not kept, since it may name what the request sent.
 */
const unreachable = () => dataError('data:OFFLINE', 'could not reach the gateway')

/** The URL a request of the client goes to, whichever form the client names it in. */
function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input)
}

/**
 * The gateway's `POST <baseUrl>/auth/sign-in/email` through Better Auth's client, and its own
 * `POST <baseUrl>/auth/sign-up/email`, `POST <baseUrl>/auth/verify-email`,
 * `POST <baseUrl>/auth/send-verification-email`, `POST <baseUrl>/auth/request-password-reset`,
 * `POST <baseUrl>/auth/reset-password`, `POST <baseUrl>/auth/change-password`,
 * `POST <baseUrl>/auth/change-email`, `POST <baseUrl>/auth/confirm-email`,
 * `POST <baseUrl>/auth/request-account-deletion`, `POST <baseUrl>/auth/delete-account` and
 * `POST <baseUrl>/auth/sign-out`, whose answers
 * are the gateway's and not Better Auth's. `baseUrl` is absolute (`https://…/backend`). A gateway
 * that cannot be reached leaves the device offline (`data:OFFLINE`); refused credentials and links
 * keep their meaning; any other answer fails the attempt with its status, never with a token, a
 * password or an email.
 */
export function gatewayAuth(baseUrl: string, fetcher: Fetcher = fetch): GatewayAuth {
  const client = createAuthClient({
    baseURL: `${baseUrl}/auth`,
    // The device keeps its token itself: no redirect, and no session store to refetch (each call
    // turns off the store's signal, which only a call's own options can).
    disableDefaultFetchPlugins: true,
    fetchOptions: {
      customFetchImpl: (input, init) => fetcher(urlOf(input), init ?? {}),
      throw: false,
    },
  })

  /** A call's options: the device it names, and no signal to the client's session store. */
  const callOptions = (device: NamedDevice) => ({
    headers: deviceHeaders(device),
    disableSignal: true,
  })

  /** The headers of a request made for the signed-in device: its session token and its id. */
  const bearer = (session: AccountSession) => ({
    Authorization: `Bearer ${session.token}`,
    'X-Perch-Device': session.device,
  })

  /**
   * Posts `body` as JSON to the gateway's own `path` under its auth, with `headers` besides. A
   * request that does not reach the gateway fails as `data:OFFLINE`, keeping nothing of its body.
   */
  const post = (path: string, body: unknown, headers: Readonly<Record<string, string>> = {}) =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}/auth/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      unreachable,
    )

  return {
    signUp: (input) =>
      post('sign-up/email', {
        name: input.name,
        email: input.email,
        password: input.password,
        locale: input.locale,
      }).andThen(signedUpOf),
    signIn: (input, device) =>
      ResultAsync.fromPromise(
        client.signIn.email({ email: input.email, password: input.password }, callOptions(device)),
        unreachable,
      ).andThen(signedIn),
    verifyEmail: (token, device) =>
      token === ''
        ? errAsync(dataError('data:LINK_INVALID', 'the link carries no token'))
        : post('verify-email', { token }, deviceHeaders(device)).andThen(verificationOf),
    resendVerification: (email) =>
      post('send-verification-email', { email }).andThen((answer) =>
        mailRequested(answer, 'the verification mail again'),
      ),
    requestPasswordReset: (email) =>
      post('request-password-reset', { email }).andThen((answer) =>
        mailRequested(answer, 'the reset mail'),
      ),
    resetPassword: (token, password) =>
      token === ''
        ? errAsync(dataError('data:LINK_INVALID', 'the link carries no token'))
        : post('reset-password', { token, password }).andThen(passwordResetOf),
    changePassword: (input, session) =>
      post('change-password', input, bearer(session)).andThen((answer) =>
        accountChangeOf(answer, 204),
      ),
    changeEmail: (input, session) =>
      post('change-email', input, bearer(session)).andThen((answer) =>
        accountChangeOf(answer, 202),
      ),
    confirmEmail: (token) =>
      token === ''
        ? errAsync(dataError('data:LINK_INVALID', 'the link carries no token'))
        : post('confirm-email', { token }).andThen(emailConfirmationOf),
    requestAccountDeletion: (password, session) =>
      post('request-account-deletion', { password }, bearer(session)).andThen((answer) =>
        accountChangeOf(answer, 202),
      ),
    deleteAccount: (token) =>
      token === ''
        ? errAsync(dataError('data:LINK_INVALID', 'the link carries no token'))
        : post('delete-account', { token }).andThen(accountDeletedOf),
    signOut: (token, device) =>
      ResultAsync.fromPromise(
        fetcher(`${baseUrl}/auth/sign-out`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'X-Perch-Device': device },
        }),
        offline,
      ).andThen(signedOutOf),
  }
}
