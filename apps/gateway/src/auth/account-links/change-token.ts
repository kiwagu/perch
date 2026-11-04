import { createHmac } from 'node:crypto'

import { signJWT, verifyJWT } from 'better-auth/crypto'

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

/**
 * What the token of an email confirmation link names: the identity whose email it changes, the
 * email it changes from and the one it changes to (both in lower case), the pending change it
 * spends (`jti`), and when it was asked, on the gateway's clock (`at`, ms since the epoch).
 */
export const changeClaims = z.object({
  purpose: z.literal('change-email'),
  identity: idSchemas.identity.schema,
  email: z.string().min(1),
  newEmail: z.string().min(1),
  jti: z.string().min(1),
  at: z.number().int(),
})

export type ChangeClaims = z.infer<typeof changeClaims>

/**
 * How long a token stays signed, in seconds: a ceiling far past the link's own lifetime, which
 * the gateway's clock judges from `at`, so a link older than a day reads as one that expired.
 */
const SIGNED_FOR_S = 365 * 24 * 60 * 60

/**
 * The key a confirmation token is signed with, derived from the auth secret: Better Auth's own
 * verification of an email reads tokens signed with the secret itself, so it can never take a
 * confirmation token for one of its own, nor the gateway one of Better Auth's for a confirmation.
 */
export const changeKey = (secret: string): string =>
  createHmac('sha256', secret).update('change-email').digest('base64url')

/** The token of a confirmation link naming `claims`, signed with `key`. */
export function signChangeToken(claims: ChangeClaims, key: string): Promise<string> {
  return signJWT({ ...claims }, key, SIGNED_FOR_S)
}

/** What `token` names when `key` signed it as a confirmation token; none for any other. */
export async function readChangeToken(
  token: string,
  key: string,
): Promise<ChangeClaims | undefined> {
  const claims = changeClaims.safeParse(await verifyJWT(token, key))

  return claims.success ? claims.data : undefined
}
