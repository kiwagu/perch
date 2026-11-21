/**
 * An account's second factor turned on through Better Auth itself, for the specs that need one:
 * the key Better Auth makes at its enable, confirmed by a code of that key, and the backup codes
 * it shows once.
 */

import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'

import type { AuthInstance } from '../auth-instance'
import { ADMISSION_HEADER } from '../session-hooks'

import { AUTH_URL, deviceHeaders } from './auth-instance'

/** A second factor that is on: its key and its backup codes, and the device's session. */
export interface SecondFactor {
  /** The key's secret, as an authenticator app keeps it once it read the key's URI. */
  readonly secret: string
  /** The ten backup codes Better Auth showed once. */
  readonly backupCodes: readonly string[]
  /**
   * The device's session token once the factor is on: Better Auth's confirmation of a code
   * while signed in replaces the device's session with a new one, which a spec signs in with.
   */
  readonly token: string
}

/** The secret of the key an `otpauth://` URI carries: its `secret`, decoded from base32. */
export function keyOf(uri: string): string {
  const secret = new URL(uri).searchParams.get('secret')

  if (secret === null) {
    throw new Error('the URI carries no secret')
  }

  return new TextDecoder().decode(base32.decode(secret))
}

/** The code the key of `secret` gives now, as an authenticator app shows it. */
export function codeOf(secret: string): Promise<string> {
  return createOTP(secret).totp()
}

/**
 * Turns on the second factor of the account signed in on `device` with `token`, its password
 * `password`: Better Auth's enable answers the key and the backup codes, and its verification of
 * a code of that key, made while signed in, turns the factor on (and replaces the device's
 * session, whose new token it answers).
 */
export async function secondFactorOn(
  auth: AuthInstance,
  device: string,
  token: string,
  password = 'Pass-word-1',
): Promise<SecondFactor> {
  const headers = deviceHeaders(device)

  headers.set('authorization', `Bearer ${token}`)

  const { totpURI, backupCodes } = await auth.api.enableTwoFactor({
    body: { password },
    headers,
  })
  const secret = keyOf(totpURI)
  const { headers: answered } = await auth.api.verifyTOTP({
    body: { code: await codeOf(secret) },
    headers,
    returnHeaders: true,
  })
  const signed = answered.get('set-auth-token')
  const read =
    signed === null
      ? null
      : await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${signed}` }) })

  if (read === null) {
    throw new Error('the confirmation of the second factor signed the device in to no session')
  }

  return { secret, backupCodes, token: read.session.token }
}

/**
 * A sign-in by `email` and `password` from `device` as the gateway hands one to Better Auth's
 * handler: at the path Better Auth serves it under, its session asked to wait for its admission.
 */
export function passwordStepRequest(email: string, password: string, device: string): Request {
  const headers = deviceHeaders(device)

  headers.set('content-type', 'application/json')
  headers.set(ADMISSION_HEADER, 'pending')

  return new Request(`${AUTH_URL}/sign-in/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  })
}
