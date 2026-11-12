import { signJWT } from 'better-auth/crypto'
import { describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'

import { changeKey } from './change-token'
import {
  type DeletionClaims,
  deletionKey,
  readDeletionToken,
  signDeletionToken,
} from './deletion-token'

const SECRET = 'test-secret-0123456789-0123456789-0123456789'

const claims: DeletionClaims = {
  purpose: 'delete-account',
  identity: idSchemas.identity.schema.parse('idn_0000000000000000.0000000000'),
  jti: 'a-deletion',
  at: Date.UTC(2026, 9, 1),
}

describe('the token of a deletion link', () => {
  it('signs the claims and reads them back with the same key', async () => {
    const key = deletionKey(SECRET)

    expect(await readDeletionToken(await signDeletionToken(claims, key), key)).toEqual(claims)
  })

  it('reads a token signed with the confirmation key, the secret itself, or another secret as nothing', async () => {
    const key = deletionKey(SECRET)

    for (const signedWith of [
      changeKey(SECRET),
      SECRET,
      deletionKey('another-secret-0123456789-0123456789'),
    ]) {
      expect(
        await readDeletionToken(await signDeletionToken(claims, signedWith), key),
      ).toBeUndefined()
    }
  })

  it('reads a token of another purpose, or not a token at all, as nothing', async () => {
    const key = deletionKey(SECRET)

    expect(
      await readDeletionToken(await signJWT({ ...claims, purpose: 'change-email' }, key), key),
    ).toBeUndefined()
    expect(await readDeletionToken('not-a-token', key)).toBeUndefined()
  })
})
