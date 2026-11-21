/**
 * The browser's half of a passkey: its window asks the person to pick or make a passkey and to
 * unlock it, and answers what the gateway's options asked for. A window closed, declined or
 * timed out is `data:PASSKEY_CANCELLED`; anything else the browser or the library refuses is
 * `data:AUTH_FAILED`.
 */

import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser'
import { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { z } from '@workspace/zod'

/**
 * The options of a sign-in the gateway answers, read as far as the browser needs them: the
 * challenge; the rest goes to the browser as it came.
 */
export const passkeyRequestOptions = z.looseObject({ challenge: z.string().min(1) })

/** The options of a registration the gateway answers, read as far as the browser needs them. */
export const passkeyCreationOptions = z.looseObject({
  challenge: z.string().min(1),
  rp: z.looseObject({ name: z.string() }),
  user: z.looseObject({ id: z.string().min(1), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.looseObject({ type: z.literal('public-key'), alg: z.number() })),
})

export interface PasskeyCeremony {
  /** Has the browser make a passkey with the gateway's `options`, and answers what it made. */
  register(
    options: PublicKeyCredentialCreationOptionsJSON,
  ): ResultAsync<RegistrationResponseJSON, DataError>
  /** Has the browser pick a passkey of this site, unlocked, and answers its assertion. */
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
  ): ResultAsync<AuthenticationResponseJSON, DataError>
}

/**
 * Whether the person or the browser ended the window: closed or declined (`NotAllowedError`, which
 * the browser also raises when the operation times out), or aborted (`AbortError`, or the
 * library's own code for a ceremony it was told to abort).
 */
const endedByTheWindow = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED'))

function ceremonyFailed(cause: unknown): DataError {
  return endedByTheWindow(cause)
    ? dataError('data:PASSKEY_CANCELLED', 'the passkey window was closed or timed out')
    : dataError('data:AUTH_FAILED', 'the browser could not complete the passkey ceremony', cause)
}

/** The real browser call of `@simplewebauthn/browser`, over `navigator.credentials`. */
export const browserPasskeyCeremony: PasskeyCeremony = {
  register: (options) =>
    ResultAsync.fromPromise(startRegistration({ optionsJSON: options }), ceremonyFailed),
  authenticate: (options) =>
    ResultAsync.fromPromise(startAuthentication({ optionsJSON: options }), ceremonyFailed),
}
