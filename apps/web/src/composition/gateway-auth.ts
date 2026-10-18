/**
 * Sign-up, sign-in and the sign-out of a pair at the gateway over HTTP. A sign-up or sign-in
 * names the device; the gateway answers with the identity and a pair of keys, which the device
 * keeps and presents when its sync channel says hello. A pair the device could not have the
 * gateway revoke while it was offline is signed out on its own later.
 */

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
import { type Membership, membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

/** A pair of keys the gateway issued a device: the access token and the refresh key. */
export interface KeyPair {
  readonly access: string
  readonly refresh: string
}

/** A device the gateway signed in: who it is, and the keys its sync channel presents. */
export interface SignedInDevice {
  readonly identity: AuthUser
  readonly tokens: KeyPair
  /** The organisations the identity belongs to. */
  readonly memberships: readonly Membership[]
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
   * Has the gateway revoke `pair`, a pair of the device `device`. A pair the gateway no longer
   * takes (it signs nobody in, or no device of the identity holds it) fails as
   * `data:AUTH_FAILED`: it is dead already. A request the gateway refuses otherwise (any other
   * 4xx) fails as `data:WRITE_REJECTED`: it will never take it. One the gateway could not revoke
   * fails as `data:WRITE_FAILED`, and an unreachable gateway as `data:OFFLINE`: the pair may be
   * sent again.
   */
  signOut(pair: KeyPair, device: string): ResultAsync<void, DataError>
}

/** The part of `fetch` the gateway's auth uses. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** What the gateway answers a successful sign-up or sign-in with. */
const signedInDevice = z.object({
  identity: z.object({ id: idSchemas.identity.schema, email: z.string() }),
  tokens: z.object({ access: z.string().min(1), refresh: z.string().min(1) }),
  memberships: z.array(membership),
})

/** The statuses the gateway refuses credentials with, and what each means here. */
const REFUSALS: ReadonlyMap<number, { readonly code: DataErrorCode; readonly message: string }> =
  new Map([
    [401, { code: 'data:INVALID_CREDENTIALS', message: 'wrong email or password' }],
    [409, { code: 'data:SIGN_UP_REJECTED', message: 'sign-up was rejected' }],
  ])

function readDevice(response: Response): ResultAsync<SignedInDevice, DataError> {
  const unexpected = (cause?: unknown) =>
    dataError(
      'data:AUTH_FAILED',
      'the gateway answered with something other than a signed-in device',
      cause,
    )

  return ResultAsync.fromPromise(response.json() as Promise<unknown>, unexpected).andThen(
    (body) => {
      const parsed = signedInDevice.safeParse(body)

      return parsed.success ? okAsync(parsed.data) : errAsync(unexpected(parsed.error))
    },
  )
}

const offline = (cause: unknown) => dataError('data:OFFLINE', 'could not reach the gateway', cause)

/**
 * The gateway's `POST <baseUrl>/auth/sign-up`, `POST <baseUrl>/auth/sign-in` and
 * `POST <baseUrl>/auth/sign-out`. A gateway that cannot be reached leaves the device offline
 * (`data:OFFLINE`); refused credentials keep their meaning; any other answer fails the attempt
 * with its status. A sign-out sends the pair as its credential, with the device in the
 * `X-Perch-Device` header and no bearer token: the access token may have expired meanwhile.
 */
export function gatewayAuth(baseUrl: string, fetcher: Fetcher = fetch): GatewayAuth {
  const post = (
    path: '/auth/sign-up' | '/auth/sign-in',
    input: SignUpInput | SignInInput,
    device: NamedDevice,
  ): ResultAsync<SignedInDevice, DataError> =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
          device: { id: device.id, label: device.label },
        }),
      }),
      offline,
    ).andThen((response) => {
      if (response.ok) {
        return readDevice(response)
      }

      const refusal = REFUSALS.get(response.status)

      return errAsync(
        refusal
          ? dataError(refusal.code, refusal.message)
          : dataError(
              'data:AUTH_FAILED',
              `the gateway refused the request with ${response.status}`,
            ),
      )
    })

  const signOut = (pair: KeyPair, device: string): ResultAsync<void, DataError> =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}/auth/sign-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Perch-Device': device },
        body: JSON.stringify({ access: pair.access, refresh: pair.refresh }),
      }),
      offline,
    ).andThen((response) => {
      if (response.status === 204) {
        return okAsync(undefined)
      }

      if (response.status === 401) {
        return errAsync(dataError('data:AUTH_FAILED', 'the gateway no longer takes the pair'))
      }

      // Any other 4xx is a request the gateway will refuse however often it is sent.
      return errAsync(
        response.status >= 400 && response.status < 500
          ? dataError(
              'data:WRITE_REJECTED',
              `the gateway refused the sign-out of the pair (${response.status})`,
            )
          : dataError(
              'data:WRITE_FAILED',
              `the gateway could not sign the pair out (${response.status})`,
            ),
      )
    })

  return {
    signUp: (input, device) => post('/auth/sign-up', input, device),
    signIn: (input, device) => post('/auth/sign-in', input, device),
    signOut,
  }
}
