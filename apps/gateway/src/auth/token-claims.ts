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

/** Where a token is issued: the namespace, the database and the access method. */
export interface TokenScope {
  readonly namespace: string
  readonly database: string
  readonly access: string
}

/**
 * The names the database reads each part of a token's scope by (SurrealDB 3.3): the upper case
 * claim it issues, the lower case one and two namespaced ones. It refuses a token that carries
 * two names of one part.
 */
const SCOPE_CLAIMS = [
  ['namespace', ['NS', 'ns', 'https://surrealdb.com/ns', 'https://surrealdb.com/namespace']],
  ['database', ['DB', 'db', 'https://surrealdb.com/db', 'https://surrealdb.com/database']],
  ['access', ['AC', 'ac', 'https://surrealdb.com/ac', 'https://surrealdb.com/access']],
] as const

/** A payload as claims by name. */
const claimsByName = z.record(z.string(), z.unknown())

/**
 * When access token `access` was issued: its `iat` claim, a whole second, as a date. Anything
 * that is not a token of three segments whose payload names that second answers `undefined`.
 */
export function issuedAtOf(access: string): Date | undefined {
  const parsed = issuedClaims.safeParse(payloadOf(access))

  return parsed.success ? new Date(parsed.data.iat * 1000) : undefined
}

/**
 * Whether access token `access` names a scope other than `scope`: a namespace, database or access
 * method claim, under any name the database reads it by, that differs from `scope`'s, or a scope
 * named only in part. A token that names no part of a scope, and anything that is not a token of
 * three segments with a JSON payload, names no other: the database judges it.
 */
export function namesOtherScope(access: string, scope: TokenScope): boolean {
  const parsed = claimsByName.safeParse(payloadOf(access))

  if (!parsed.success) {
    return false
  }

  const claims = parsed.data
  const parts = SCOPE_CLAIMS.map(([part, names]) => ({
    expected: scope[part],
    named: names.filter((name) => Object.hasOwn(claims, name)).map((name) => claims[name]),
  }))

  if (parts.every(({ named }) => named.length === 0)) {
    return false
  }

  return parts.some(
    ({ expected, named }) => named.length === 0 || named.some((value) => value !== expected),
  )
}
