/**
 * The claims of an access token that the gateway reads itself. The database verifies a token
 * before the gateway reads any of its claims, so the signature is not checked again here.
 */

import { Buffer } from 'node:buffer'

import { z } from '@workspace/zod'

/** The claims read here; a token carries others, which are left alone. */
const claims = z.object({ iat: z.number().int() })

/**
 * When access token `access` was issued: its `iat` claim, a whole second, as a date. Anything
 * that is not a token of three segments whose payload names that second answers `undefined`.
 */
export function issuedAtOf(access: string): Date | undefined {
  const segments = access.split('.')
  const payload = segments[1]

  if (segments.length !== 3 || payload === undefined) {
    return undefined
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
    const parsed = claims.safeParse(decoded)

    return parsed.success ? new Date(parsed.data.iat * 1000) : undefined
  } catch {
    // A payload that is not JSON names no second, like one without the claim.
    return undefined
  }
}
