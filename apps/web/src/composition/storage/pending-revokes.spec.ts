import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { deviceIdFrom } from './device'
import { memoryStorage } from './key-value'
import { addPendingRevoke, forgetPendingRevoke, pendingRevokes } from './pending-revokes'
import { forgetDevice, saveDevice } from './signed-in'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
  memberships: [] as readonly Membership[],
}

describe('the pairs left to revoke', () => {
  const annPair = { ...ann.tokens, device: 'device-1' }
  const bobPair = { access: 'access-b', refresh: 'refresh-b', device: 'device-1' }

  it('keeps a pair per sign-out the gateway did not confirm, each forgotten on its own; forgetting the device leaves them', () => {
    const storage = memoryStorage()

    expect(pendingRevokes(storage)).toEqual([])

    saveDevice(storage, ann)

    expect(addPendingRevoke(storage, annPair)).toEqual([])
    expect(addPendingRevoke(storage, bobPair)).toEqual([])
    // A pair kept already is not kept twice.
    expect(addPendingRevoke(storage, annPair)).toEqual([])

    forgetDevice(storage)

    expect(pendingRevokes(storage)).toEqual([annPair, bobPair])

    forgetPendingRevoke(storage, annPair.refresh)

    expect(pendingRevokes(storage)).toEqual([bobPair])

    forgetPendingRevoke(storage, bobPair.refresh)

    expect(pendingRevokes(storage)).toEqual([])
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it('keeps at most 8 pairs: one more drops the oldest, which it answers', () => {
    const storage = memoryStorage()
    const pairs = Array.from({ length: 9 }, (_, n) => ({
      access: `access-${n}`,
      refresh: `refresh-${n}`,
      device: 'device-1',
    }))
    const dropped = pairs.map((pair) => addPendingRevoke(storage, pair))

    expect(dropped.slice(0, 8).every((each) => each.length === 0)).toBe(true)
    expect(dropped[8]).toEqual([pairs[0]])
    expect(pendingRevokes(storage)).toEqual(pairs.slice(1))
  })

  it('reads a pair kept alone, as before the list, as a list of one from this device', () => {
    const storage = memoryStorage()

    storage.set('perch.session.pending-revoke', JSON.stringify(ann.tokens))

    expect(pendingRevokes(storage)).toEqual([{ ...ann.tokens, device: deviceIdFrom(storage) }])
  })

  it('reads no pair from a value that does not describe one, and skips an entry that does not', () => {
    const storage = memoryStorage()

    for (const value of [
      'not json',
      '{"access":"a"}',
      '{"access":"","refresh":"r"}',
      '[]',
      '[{"access":"a","refresh":"r"}]',
    ]) {
      storage.set('perch.session.pending-revoke', value)

      expect(pendingRevokes(storage)).toEqual([])
    }

    storage.set(
      'perch.session.pending-revoke',
      JSON.stringify([{ access: 'a', refresh: 'r', device: '' }, annPair]),
    )

    expect(pendingRevokes(storage)).toEqual([annPair])
  })
})
