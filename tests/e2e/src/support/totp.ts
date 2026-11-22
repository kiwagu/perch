/**
 * The codes an authenticator app shows for the key the settings show, computed as the gateway
 * checks them: Better Auth's own TOTP (`createOTP`, 6 digits, 30-second steps), whose secret is
 * what the key's base32 text encodes.
 */

import { base32 } from '@better-auth/utils/base32'
import { createOTP } from '@better-auth/utils/otp'

/** One step of a TOTP, in milliseconds. */
const STEP_MS = 30_000

/**
 * The last stretch of a step a code is not computed in: typing it takes a moment, and a code
 * that ends its step before the gateway reads it would lean on the window the gateway allows
 * around the step, so it waits for the next step instead.
 */
const EDGE_MS = 3_000

/** The secret of the key an authenticator app keeps: the bytes the key's base32 text encodes. */
function secretOf(key: string): string {
  return new TextDecoder().decode(base32.decode(key.trim()))
}

/**
 * The code the key gives now, computed just before it is typed. One asked in the last 3 seconds
 * of its 30-second step waits for the next step first.
 */
export async function totpFor(key: string): Promise<string> {
  const left = STEP_MS - (Date.now() % STEP_MS)

  if (left < EDGE_MS) {
    await new Promise((resolve) => setTimeout(resolve, left + 100))
  }

  return createOTP(secretOf(key)).totp()
}

/**
 * A code the key does not give: the code of another key, drawn again until it is none of the
 * codes of the previous, the current and the next step of the enrolled key, nor of the two steps
 * beyond, which a moment's wait across a step's edge could bring in.
 */
export async function wrongCodeFor(key: string): Promise<string> {
  const enrolled = createOTP(secretOf(key))
  const step = Math.floor(Date.now() / STEP_MS)
  const accepted = new Set(
    await Promise.all([-2, -1, 0, 1, 2].map((offset) => enrolled.hotp(step + offset))),
  )
  let code: string

  do {
    code = await createOTP(crypto.randomUUID()).totp()
  } while (accepted.has(code))

  return code
}
