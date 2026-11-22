/**
 * The browser's half of a passkey: its window asks the person to pick or make a passkey and to
 * unlock it, and answers what the gateway's options asked for. A window closed, declined or
 * timed out is `data:PASSKEY_CANCELLED`; anything else the browser or the library refuses is
 * `data:AUTH_FAILED`.
 */

import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
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
 * The library that runs the ceremony, loaded when a passkey control is first pressed and never
 * with the first frame: it is code run only after the person's own action on a control. The
 * browser loads it once, however often it is asked.
 */
const loadLibrary = () => import('@simplewebauthn/browser')

type Library = Awaited<ReturnType<typeof loadLibrary>>

/**
 * Whether the person or the browser ended the window: closed or declined (`NotAllowedError`, which
 * the browser also raises when the operation times out), or aborted (`AbortError`, or the
 * library's own code for a ceremony it was told to abort).
 */
const endedByTheWindow = (error: unknown, { WebAuthnError }: Library): boolean =>
  error instanceof Error &&
  (error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED'))

function ceremonyFailed(cause: unknown, library: Library): DataError {
  return endedByTheWindow(cause, library)
    ? dataError('data:PASSKEY_CANCELLED', 'the passkey window was closed or timed out')
    : dataError('data:AUTH_FAILED', 'the browser could not complete the passkey ceremony', cause)
}

/** Runs one ceremony of the library, loading it first; a library that cannot load fails the ceremony, naming it. */
function ceremony<T>(run: (library: Library) => Promise<T>): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(loadLibrary(), (cause) =>
    dataError('data:AUTH_FAILED', 'the passkey library could not be loaded', cause),
  ).andThen((library) =>
    ResultAsync.fromPromise(run(library), (cause) => ceremonyFailed(cause, library)),
  )
}

/** The real browser call of `@simplewebauthn/browser`, over `navigator.credentials`. */
export const browserPasskeyCeremony: PasskeyCeremony = {
  register: (options) =>
    ceremony(({ startRegistration }) => startRegistration({ optionsJSON: options })),
  authenticate: (options) =>
    ceremony(({ startAuthentication }) => startAuthentication({ optionsJSON: options })),
}
