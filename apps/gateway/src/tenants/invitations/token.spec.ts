import { createHmac } from 'node:crypto'

import { signJWT } from 'better-auth/crypto'
import { describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'

import {
  type InvitationClaims,
  invitationKey,
  readInvitationToken,
  signInvitationToken,
} from './token'

const SECRET = 'test-secret-0123456789-0123456789-0123456789'

/** A key derived from the secret under `purpose`, as the gateway derives those of its other links. */
const derivedKey = (purpose: string): string =>
  createHmac('sha256', SECRET).update(purpose).digest('base64url')

const claims: InvitationClaims = {
  purpose: 'invitation',
  invitation: idSchemas.invitation.schema.parse('inv_0000000000000000.0000000000'),
  at: Date.UTC(2026, 10, 7),
}

describe('the token of an invitation link', () => {
  it('signs the claims and reads them back with the same key', async () => {
    const key = invitationKey(SECRET)

    expect(await readInvitationToken(await signInvitationToken(claims, key), key)).toEqual(claims)
  })

  it('reads a token signed with the deletion key, the confirmation key, the secret itself or another secret as nothing', async () => {
    const key = invitationKey(SECRET)

    for (const signedWith of [
      derivedKey('delete-account'),
      derivedKey('change-email'),
      SECRET,
      invitationKey('another-secret-0123456789-0123456789'),
    ]) {
      expect(
        await readInvitationToken(await signInvitationToken(claims, signedWith), key),
      ).toBeUndefined()
    }
  })

  it('reads a token of another purpose, or not a token at all, as nothing', async () => {
    const key = invitationKey(SECRET)

    expect(
      await readInvitationToken(await signJWT({ ...claims, purpose: 'delete-account' }, key), key),
    ).toBeUndefined()
    expect(await readInvitationToken('not-a-token', key)).toBeUndefined()
  })

  it('reads a token whose invitation is not an invitation id as nothing', async () => {
    const key = invitationKey(SECRET)

    expect(
      await readInvitationToken(
        await signJWT({ ...claims, invitation: 'idn_0000000000000000.0000000000' }, key),
        key,
      ),
    ).toBeUndefined()
  })
})
