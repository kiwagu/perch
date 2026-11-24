/**
 * The gateway's auth as the device calls it: Better Auth's client for the sign-in, the gateway's
 * own answers for the sign-up, the verification of an email, its resend and the sign-out.
 */

import { createAuthClient } from 'better-auth/client'
import { errAsync, ResultAsync } from 'neverthrow'

import { dataError } from '@workspace/data'

import { accountChangeOf } from './account-change'
import { accountDeletedOf } from './account-deletion'
import type { AccountSession, Fetcher, GatewayAuth } from './auth.port'
import { confirmedOf } from './confirm-sign-in'
import { emailConfirmationOf } from './email-confirmation'
import { mailRequested } from './mail-request'
import { passkeyOptionsOf, passkeySignedInOf } from './passkey-sign-in'
import { passwordResetOf } from './password-reset'
import { signedOutOf } from './sign-out'
import { signedUpOf } from './sign-up'
import { deviceHeaders, type NamedDevice, signedIn } from './signed-in'
import { verificationOf } from './verification'

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
 * `POST <baseUrl>/auth/confirm-sign-in`, `POST <baseUrl>/auth/passkey-options`,
 * `POST <baseUrl>/auth/sign-in/passkey`, `POST <baseUrl>/auth/sign-up/email`,
 * `POST <baseUrl>/auth/verify-email`,
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
   * Posts `body` as JSON (none when it is `undefined`) to the gateway's own `path` under its auth,
   * with `headers` besides. A request that does not reach the gateway fails as `data:OFFLINE`,
   * keeping nothing of its body.
   */
  const post = (path: string, body: unknown, headers: Readonly<Record<string, string>> = {}) =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}/auth/${path}`, {
        method: 'POST',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
        client.signIn.email(
          {
            email: input.email,
            password: input.password,
            // The confirmation goes only with a sign-in that confirms.
            ...(input.signOutOldest === true ? { signOutOldest: true } : {}),
          },
          callOptions(device),
        ),
        unreachable,
      ).andThen(signedIn),
    confirmSignIn: (step, device) =>
      post(
        'confirm-sign-in',
        {
          challenge: step.challenge,
          email: step.email,
          code: step.code,
          // The confirmation goes only with a step that confirms.
          ...(step.signOutOldest ? { signOutOldest: true } : {}),
        },
        deviceHeaders(device),
      ).andThen(confirmedOf),
    passkeyOptions: (device) =>
      post('passkey-options', undefined, deviceHeaders(device)).andThen(passkeyOptionsOf),
    signInWithPasskey: (input, device) =>
      post(
        'sign-in/passkey',
        {
          response: input.response,
          challenge: input.challenge,
          ...(input.signOutOldestFor === undefined
            ? {}
            : { signOutOldestFor: input.signOutOldestFor }),
        },
        deviceHeaders(device),
      ).andThen(passkeySignedInOf),
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
    resetPassword: (token, password, session) =>
      token === ''
        ? errAsync(dataError('data:LINK_INVALID', 'the link carries no token'))
        : post(
            'reset-password',
            { token, password },
            session === undefined ? {} : bearer(session),
          ).andThen(passwordResetOf),
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
