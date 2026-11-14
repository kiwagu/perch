import { createHmac } from 'node:crypto'

import { signJWT, verifyJWT } from 'better-auth/crypto'

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

/**
 * What the token of an account deletion link names: the identity whose account it deletes, the
 * pending deletion it spends (`jti`), and when it was asked, on the gateway's clock (`at`, ms
 * since the epoch).
 */
export const deletionClaims = z.object({
  purpose: z.literal('delete-account'),
  identity: idSchemas.identity.schema,
  jti: z.string().min(1),
  at: z.number().int(),
})

export type DeletionClaims = z.infer<typeof deletionClaims>

/**
 * How long a token stays signed, in seconds: a ceiling far past the link's own lifetime, which
 * the gateway's clock judges from `at`, so a link older than an hour reads as one that expired.
 */
const SIGNED_FOR_S = 365 * 24 * 60 * 60

/**
 * The key a deletion token is signed with, derived from the auth secret: Better Auth's own
 * verification of an email reads tokens signed with the secret itself, and the confirmation of an
 * email change reads tokens signed with its own derived key, so a deletion token is never taken
 * for either of them, nor either of them for a deletion token.
 */
export const deletionKey = (secret: string): string =>
  createHmac('sha256', secret).update('delete-account').digest('base64url')

/** The token of a deletion link naming `claims`, signed with `key`. */
export function signDeletionToken(claims: DeletionClaims, key: string): Promise<string> {
  return signJWT({ ...claims }, key, SIGNED_FOR_S)
}

/** What `token` names when `key` signed it as a deletion token; none for any other. */
export async function readDeletionToken(
  token: string,
  key: string,
): Promise<DeletionClaims | undefined> {
  const claims = deletionClaims.safeParse(await verifyJWT(token, key))

  return claims.success ? claims.data : undefined
}
