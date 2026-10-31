/**
 * The gateway's auth as the device calls it: Better Auth's client for the sign-up and the sign-in,
 * the gateway's own routes for the verification of an email, its resend and the sign-out.
 */

import { createAuthClient } from 'better-auth/client'
import { errAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type SignInInput, type SignUpInput } from '@workspace/data'

import { resentOf } from './resend'
import { signedOutOf } from './sign-out'
import { deviceHeaders, type NamedDevice, type SignedInDevice, signedIn } from './signed-in'
import { type EmailVerification, verificationOf } from './verification'

export interface GatewayAuth {
  signUp(input: SignUpInput, device: NamedDevice): ResultAsync<SignedInDevice, DataError>
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
   * Has the gateway sign out `token`, the session token of the device `device`. A token the
   * gateway no longer takes (it signs nobody in, or another device holds it) fails as
   * `data:AUTH_FAILED`: it is dead already. A request the gateway refuses otherwise (any other
   * 4xx) fails as `data:WRITE_REJECTED`: it will never take it. One the gateway could not
   * complete fails as `data:WRITE_FAILED`, and an unreachable gateway as `data:OFFLINE`: the
   * token may be sent again.
   */
  signOut(token: string, device: string): ResultAsync<void, DataError>
}

/** The part of `fetch` the gateway's auth uses. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const offline = (cause: unknown) => dataError('data:OFFLINE', 'could not reach the gateway', cause)

/**
 * An unreachable gateway, for a request that carries a link's token or an email: the rejection is
 * not kept, since it may name what the request sent.
 */
const unreachable = () => dataError('data:OFFLINE', 'could not reach the gateway')

/** The URL a request of the client goes to, whichever form the client names it in. */
function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input)
}

/**
 * The gateway's `POST <baseUrl>/auth/sign-up/email` and `POST <baseUrl>/auth/sign-in/email`
 * through Better Auth's client, and its own `POST <baseUrl>/auth/verify-email`,
 * `POST <baseUrl>/auth/send-verification-email` and `POST <baseUrl>/auth/sign-out`, whose answers
 * are the gateway's and not Better Auth's. `baseUrl` is absolute (`https://…/backend`). A gateway
 * that cannot be reached leaves the device offline (`data:OFFLINE`); refused credentials and links
 * keep their meaning; any other answer fails the attempt with its status, never with a token.
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
    signUp: (input, device) =>
      ResultAsync.fromPromise(
        client.signUp.email(
          { name: input.name, email: input.email, password: input.password },
          callOptions(device),
        ),
        offline,
      ).andThen(signedIn),
    signIn: (input, device) =>
      ResultAsync.fromPromise(
        client.signIn.email({ email: input.email, password: input.password }, callOptions(device)),
        offline,
      ).andThen(signedIn),
    verifyEmail: (token, device) =>
      token === ''
        ? errAsync(dataError('data:LINK_INVALID', 'the link carries no token'))
        : post('verify-email', { token }, deviceHeaders(device)).andThen(verificationOf),
    resendVerification: (email) => post('send-verification-email', { email }).andThen(resentOf),
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
