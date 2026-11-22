/**
 * An account's second factor turned on through Better Auth itself, for the specs that need one:
 * the key Better Auth makes at its enable, confirmed by a code of that key, and the backup codes
 * it shows once.
 */

import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'

import { fromDriverValue } from '@workspace/data'
import { z } from '@workspace/zod'

import { internalRequest, setCookieValue, twoFactorChallenges } from '../auth-handler'
import type { AuthInstance } from '../auth-instance'
import { ADMISSION_HEADER } from '../session-hooks'

import { AUTH_URL, deviceHeaders, type OpenedAuth } from './auth-instance'
import twoFactorStateStatement from './two-factor-state.surql'

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

/** The backup codes of `identity` (its key) not used up yet, as Better Auth reads them. */
export async function backupCodesOf(auth: AuthInstance, identity: string): Promise<string[]> {
  const { backupCodes } = await auth.api.viewBackupCodes({ body: { userId: identity } })

  return backupCodes
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

/**
 * A code that is none of the codes the key of `secret` accepts now: not the code of the previous,
 * the current or the next step of 30 seconds, nor of the two steps beyond, which a moment's wait
 * across a step's edge could bring in. It is the code of another key, drawn again until it is
 * none of them.
 */
export async function wrongCodeOf(secret: string): Promise<string> {
  const enrolled = createOTP(secret)
  const counter = Math.floor(Date.now() / 30_000)
  const accepted = new Set(
    await Promise.all([-2, -1, 0, 1, 2].map((step) => enrolled.hotp(counter + step))),
  )
  let code: string

  do {
    code = await createOTP(crypto.randomUUID()).totp()
  } while (accepted.has(code))

  return code
}

/** The account's flag and its two-factor rows, as the directory keeps them. */
const twoFactorState = z.object({
  enabled: z.boolean().nullish(),
  rows: z.array(
    z.object({
      id: z.string(),
      verified: z.boolean(),
      secret: z.string(),
      backup_codes: z.string(),
    }),
  ),
})

/** The second-factor flag of `identity` (its key) and its two-factor rows. */
export async function stateOf(opened: OpenedAuth, identity: string) {
  const [state] = await opened.local.db.query<[unknown]>(twoFactorStateStatement, { identity })

  return twoFactorState.parse(fromDriverValue(state))
}

/**
 * The second step of a sign-in by `email` from `device`: its password step run through Better
 * Auth's handler for the challenge, then `code` sent to `path` (`/two-factor/verify-totp` or
 * `/two-factor/verify-backup-code`) with that challenge, as the gateway sends it.
 */
export async function secondStep(
  opened: OpenedAuth,
  device: string,
  path: string,
  code: string,
  email = 'ann@example.test',
): Promise<Response> {
  const challenges = twoFactorChallenges(opened.auth, opened.local)
  const asked = await opened.auth.handler(passwordStepRequest(email, 'Pass-word-1', device))

  // The password's answer is a challenge, not a session.
  z.object({ twoFactorRedirect: z.literal(true) }).parse(await asked.clone().json())

  const challenge = setCookieValue(asked, await challenges.cookieName())

  if (challenge === undefined) {
    throw new Error('the password step answered no challenge')
  }

  return opened.auth.handler(
    internalRequest({
      publicUrl: 'http://localhost',
      path,
      device: { id: device, label: 'Firefox on Linux' },
      challenge: { name: await challenges.cookieName(), value: challenge },
      pending: true,
      body: { code },
    }),
  )
}
