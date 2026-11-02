import { createHmac } from 'node:crypto'

import { signJWT, verifyJWT } from 'better-auth/crypto'

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

/**
 * What the token of a verification link names: the account the mail went to (`identity`), and
 * Better Auth's own token (`token`), which names the email alone and is what verifies it. Better
 * Auth's token cannot tell one account of an email from another: an email freed by a confirmation
 * and taken by a new sign-up names the new account, so the link carries the account it was
 * mailed to beside it.
 */
export const verificationClaims = z.object({
  purpose: z.literal('verify-email'),
  identity: idSchemas.identity.schema,
  token: z.string().min(1),
})

export type VerificationClaims = z.infer<typeof verificationClaims>

/**
 * How long a token stays signed, in seconds: a ceiling far past the link's own lifetime, which
 * Better Auth's token inside carries, so a link older than a day reads as one that expired.
 */
const SIGNED_FOR_S = 365 * 24 * 60 * 60

/**
 * The key a verification link's token is signed with, derived from the auth secret: Better Auth
 * reads tokens signed with the secret itself, so it can never take the link's token for one of
 * its own, nor the gateway one of Better Auth's, or a confirmation's, for a link's.
 */
export const verificationKey = (secret: string): string =>
  createHmac('sha256', secret).update('verify-email').digest('base64url')

/** The token of a verification link naming `claims`, signed with `key`. */
export function signVerificationToken(claims: VerificationClaims, key: string): Promise<string> {
  return signJWT({ ...claims }, key, SIGNED_FOR_S)
}

/** What `token` names when `key` signed it as a verification link's token; none for any other. */
export async function readVerificationToken(
  token: string,
  key: string,
): Promise<VerificationClaims | undefined> {
  const claims = verificationClaims.safeParse(await verifyJWT(token, key))

  return claims.success ? claims.data : undefined
}
