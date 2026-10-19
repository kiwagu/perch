/**
 * The claims of an access token that the gateway reads itself. The database verifies a token
 * before the gateway reads any of its claims, so the signature is not checked again here.
 */

import { Buffer } from 'node:buffer'

import { z } from '@workspace/zod'

/** The payload of a token of three segments, as untyped JSON; `undefined` for anything else. */
function payloadOf(access: string): unknown {
  const segments = access.split('.')
  const payload = segments[1]

  if (segments.length !== 3 || payload === undefined) {
    return undefined
  }

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown
  } catch {
    // A payload that is not JSON names no claim.
    return undefined
  }
}

/** The claims read here; a token carries others, which are left alone. */
const issuedClaims = z.object({ iat: z.number().int() })

/** Where the database issued a token: its namespace, database and access method, upper case. */
const scopeClaims = z.object({ NS: z.string(), DB: z.string(), AC: z.string() })

/**
 * When access token `access` was issued: its `iat` claim, a whole second, as a date. Anything
 * that is not a token of three segments whose payload names that second answers `undefined`.
 */
export function issuedAtOf(access: string): Date | undefined {
  const parsed = issuedClaims.safeParse(payloadOf(access))

  return parsed.success ? new Date(parsed.data.iat * 1000) : undefined
}

/**
 * The namespace, database and access method access token `access` was issued for: its `NS`, `DB`
 * and `AC` claims. Anything that is not a token of three segments whose payload names all three
 * answers `undefined`.
 */
export function scopeOf(
  access: string,
): { namespace: string; database: string; access: string } | undefined {
  const parsed = scopeClaims.safeParse(payloadOf(access))

  return parsed.success
    ? { namespace: parsed.data.NS, database: parsed.data.DB, access: parsed.data.AC }
    : undefined
}
