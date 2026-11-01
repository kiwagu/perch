/**
 * Sign-up, sign-in and the sign-out of a session token at the gateway over HTTP. A sign-up or
 * sign-in names the device; the gateway answers with the account and a session token, which the
 * device keeps and presents on every route and when its sync channel says hello. A token the
 * device could not have the gateway sign out while it was offline is signed out on its own later.
 */

import { createAuthClient } from 'better-auth/client'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import {
  type AuthUser,
  type DataError,
  type DataErrorCode,
  dataError,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

/**
 * A device the gateway signed in: who it is and the session token it presents. The session reads
 * the identity's memberships with the token once it keeps it.
 */
export interface SignedInDevice {
  readonly identity: AuthUser
  /** The raw session token of the answer's body, as the gateway keeps it for the device. */
  readonly token: string
}

/** The device a sign-up or sign-in names: the browser's own id, and a label for people to read. */
export interface NamedDevice {
  readonly id: string
  readonly label: string
}

export interface GatewayAuth {
  signUp(input: SignUpInput, device: NamedDevice): ResultAsync<SignedInDevice, DataError>
  signIn(input: SignInInput, device: NamedDevice): ResultAsync<SignedInDevice, DataError>
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

/**
 * What a successful sign-up or sign-in answers with. Only the body's token is the session's own:
 * the `set-auth-token` header carries it signed, which the gateway's own routes do not match.
 */
const signedInAccount = z.object({
  token: z.string().min(1),
  user: z.object({ id: idSchemas.identity.schema, email: z.string() }),
})

/** The statuses the gateway refuses credentials with, and what each means here. */
const REFUSALS: ReadonlyMap<number, { readonly code: DataErrorCode; readonly message: string }> =
  new Map([
    [401, { code: 'data:INVALID_CREDENTIALS', message: 'wrong email or password' }],
    [422, { code: 'data:SIGN_UP_REJECTED', message: 'sign-up was rejected' }],
    [429, { code: 'data:RATE_LIMITED', message: 'too many attempts' }],
  ])

const offline = (cause: unknown) => dataError('data:OFFLINE', 'could not reach the gateway', cause)

/** The sign-up's or sign-in's answer as the client reads it: its body, or the status it refused with. */
interface Answer {
  readonly data: unknown
  readonly error: { readonly status: number } | null
}

function refused(status: number): DataError {
  const refusal = REFUSALS.get(status)

  return refusal
    ? dataError(refusal.code, refusal.message)
    : dataError('data:AUTH_FAILED', `the gateway refused the request with ${status}`)
}

function signedIn(answer: Answer): ResultAsync<SignedInDevice, DataError> {
  if (answer.error) {
    return errAsync(refused(answer.error.status))
  }

  const parsed = signedInAccount.safeParse(answer.data)

  return parsed.success
    ? okAsync({
        identity: { id: parsed.data.user.id, email: parsed.data.user.email },
        token: parsed.data.token,
      })
    : errAsync(
        dataError(
          'data:AUTH_FAILED',
          'the gateway answered with something other than a signed-in account',
          parsed.error,
        ),
      )
}

/** The URL a request of the client goes to, whichever form the client names it in. */
function urlOf(input: string | URL | Request): string {
  return input instanceof Request ? input.url : String(input)
}

/**
 * The gateway's `POST <baseUrl>/auth/sign-up/email` and `POST <baseUrl>/auth/sign-in/email`
 * through Better Auth's client, and `POST <baseUrl>/auth/sign-out`.
 * `baseUrl` is absolute (`https://…/backend`). A gateway that cannot be reached leaves the device
 * offline (`data:OFFLINE`); refused credentials keep their meaning; any other answer fails the
 * attempt with its status, never with the token.
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
    headers: { 'X-Perch-Device': device.id, 'X-Perch-Device-Label': device.label },
    disableSignal: true,
  })

  const signOut = (token: string, device: string): ResultAsync<void, DataError> =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}/auth/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Perch-Device': device },
      }),
      offline,
    ).andThen((response) => {
      if (response.status === 204) {
        return okAsync(undefined)
      }

      if (response.status === 401) {
        return errAsync(dataError('data:AUTH_FAILED', 'the gateway no longer takes the token'))
      }

      // Asked to wait: the token is still live, so this is not a refusal for good.
      if (response.status === 429) {
        return errAsync(
          dataError('data:RATE_LIMITED', 'the gateway asks to wait before the sign-out'),
        )
      }

      // Any other 4xx is a request the gateway will refuse however often it is sent.
      return errAsync(
        response.status >= 400 && response.status < 500
          ? dataError(
              'data:WRITE_REJECTED',
              `the gateway refused the sign-out of the token (${response.status})`,
            )
          : dataError(
              'data:WRITE_FAILED',
              `the gateway could not sign the token out (${response.status})`,
            ),
      )
    })

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
    signOut,
  }
}
