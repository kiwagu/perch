import { createHmac } from 'node:crypto'

import { signJWT, verifyJWT } from 'better-auth/crypto'

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

/**
 * What the token of an invitation link names: the invitation it opens (the row's id, minted once
 * per invitation and never reused), and when it was sent, on the gateway's clock (`at`, ms since
 * the epoch).
 */
export const invitationClaims = z.object({
  purpose: z.literal('invitation'),
  invitation: idSchemas.invitation.schema,
  at: z.number().int(),
})

export type InvitationClaims = z.infer<typeof invitationClaims>

/**
 * How long a token stays signed, in seconds: a ceiling far past the link's own lifetime, which
 * the gateway's clock judges from `at`, so a link older than a week reads as one that expired,
 * also once its row was swept.
 */
const SIGNED_FOR_S = 365 * 24 * 60 * 60

/**
 * The key an invitation token is signed with, derived from the auth secret: Better Auth's own
 * verification of an email reads tokens signed with the secret itself, and the links of an email
 * change and of an account deletion are signed with keys of their own, so an invitation token is
 * never taken for any of them, nor any of them for an invitation token.
 */
export const invitationKey = (secret: string): string =>
  createHmac('sha256', secret).update('invitation').digest('base64url')

/** The token of an invitation link naming `claims`, signed with `key`. */
export function signInvitationToken(claims: InvitationClaims, key: string): Promise<string> {
  return signJWT({ ...claims }, key, SIGNED_FOR_S)
}

/** What `token` names when `key` signed it as an invitation token; none for any other. */
export async function readInvitationToken(
  token: string,
  key: string,
): Promise<InvitationClaims | undefined> {
  const claims = invitationClaims.safeParse(await verifyJWT(token, key))

  return claims.success ? claims.data : undefined
}
