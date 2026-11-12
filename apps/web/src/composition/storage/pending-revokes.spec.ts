import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { signedIn, signedOut } from '../__fixtures__/signed-in'

import { memoryStorage } from './key-value'
import { addPendingRevoke, forgetPendingRevoke, pendingRevokes } from './pending-revokes'
import { savedSession } from './signed-in'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
}

describe('the session tokens left to sign out', () => {
  const annLeft = { token: ann.token, device: 'device-1' }
  const bobLeft = { token: 'token-bob', device: 'device-1' }

  it('keeps a token per sign-out the gateway did not confirm, each forgotten on its own; the sign-out leaves them', () => {
    const storage = memoryStorage()

    expect(pendingRevokes(storage)).toEqual([])

    signedIn(storage, ann)

    expect(addPendingRevoke(storage, annLeft)).toEqual([])
    expect(addPendingRevoke(storage, bobLeft)).toEqual([])
    // A token kept already is not kept twice.
    expect(addPendingRevoke(storage, annLeft)).toEqual([])

    signedOut(storage)

    expect(savedSession(storage)).toBeUndefined()
    expect(pendingRevokes(storage)).toEqual([annLeft, bobLeft])

    forgetPendingRevoke(storage, annLeft.token)

    expect(pendingRevokes(storage)).toEqual([bobLeft])

    forgetPendingRevoke(storage, bobLeft.token)

    expect(pendingRevokes(storage)).toEqual([])
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it('keeps at most 8 tokens: one more drops the oldest, which it answers', () => {
    const storage = memoryStorage()
    const tokens = Array.from({ length: 9 }, (_, n) => ({
      token: `token-${n}`,
      device: 'device-1',
    }))
    const dropped = tokens.map((left) => addPendingRevoke(storage, left))

    expect(dropped.slice(0, 8).every((each) => each.length === 0)).toBe(true)
    expect(dropped[8]).toEqual([tokens[0]])
    expect(pendingRevokes(storage)).toEqual(tokens.slice(1))
  })

  it('reads no token from a value that does not describe one, and skips an entry that does not', () => {
    const storage = memoryStorage()

    for (const value of [
      'not json',
      '{"token":"t","device":"device-1"}',
      '[]',
      '[{"token":"t"}]',
      '[{"token":"","device":"device-1"}]',
      // What an older build kept: a pair of keys the gateway no longer knows.
      '[{"access":"a","refresh":"r","device":"device-1"}]',
      '{"access":"a","refresh":"r"}',
    ]) {
      storage.set('perch.session.pending-revoke', value)

      expect(pendingRevokes(storage)).toEqual([])
    }

    storage.set(
      'perch.session.pending-revoke',
      JSON.stringify([{ token: 't', device: '' }, annLeft]),
    )

    expect(pendingRevokes(storage)).toEqual([annLeft])
  })
})
