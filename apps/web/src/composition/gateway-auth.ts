/**
 * Sign-up and sign-in at the gateway over HTTP. The gateway answers with the identity and a
 * pair of keys; the device keeps them and presents them when its sync channel says hello.
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
import { z } from '@workspace/zod'

/** A device the gateway signed in: who it is, and the keys its sync channel presents. */
export interface SignedInDevice {
  readonly identity: AuthUser
  readonly tokens: { readonly access: string; readonly refresh: string }
}

export interface GatewayAuth {
  signUp(input: SignUpInput): ResultAsync<SignedInDevice, DataError>
  signIn(input: SignInInput): ResultAsync<SignedInDevice, DataError>
}

/** The part of `fetch` the gateway's auth uses. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** What the gateway answers a successful sign-up or sign-in with. */
const signedInDevice = z.object({
  identity: z.object({ id: idSchemas.identity.schema, email: z.string() }),
  tokens: z.object({ access: z.string().min(1), refresh: z.string().min(1) }),
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

/**
 * The gateway's `POST <baseUrl>/auth/sign-up` and `POST <baseUrl>/auth/sign-in`. A gateway
 * that cannot be reached leaves the device offline (`data:OFFLINE`); refused credentials keep
 * their meaning; any other answer fails the attempt with its status.
 */
export function gatewayAuth(baseUrl: string, fetcher: Fetcher = fetch): GatewayAuth {
  const post = (
    path: '/auth/sign-up' | '/auth/sign-in',
    input: SignUpInput | SignInInput,
  ): ResultAsync<SignedInDevice, DataError> =>
    ResultAsync.fromPromise(
      fetcher(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.password }),
      }),
      (cause) => dataError('data:OFFLINE', 'could not reach the gateway', cause),
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

  return {
    signUp: (input) => post('/auth/sign-up', input),
    signIn: (input) => post('/auth/sign-in', input),
  }
}
