import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { ConnectionRegistry } from './connections'

/** A connection that keeps what it is told of its identity's memberships. */
function connection() {
  const heard: Array<readonly Membership[]> = []

  return { heard, memberships: (next: readonly Membership[]) => heard.push(next) }
}

describe('ConnectionRegistry', () => {
  it('answers add with a function that removes the connection', () => {
    const registry = new ConnectionRegistry()
    const ann = identityIdFactory.create()
    const device = connection()
    const remove = registry.add(ann, device)

    expect(registry.forIdentity(ann)).toEqual([device])

    remove()
    remove()

    expect(registry.forIdentity(ann)).toEqual([])
  })

  it('answers forIdentity with the live connections of that identity only', () => {
    const registry = new ConnectionRegistry()
    const ann = identityIdFactory.create()
    const bob = identityIdFactory.create()
    const laptop = connection()
    const phone = connection()
    const bobs = connection()
    const removeLaptop = registry.add(ann, laptop)

    registry.add(ann, phone)
    registry.add(bob, bobs)
    removeLaptop()

    expect(registry.forIdentity(ann)).toEqual([phone])
    expect(registry.forIdentity(bob)).toEqual([bobs])
    expect(registry.forIdentity(identityIdFactory.create())).toEqual([])
  })
})
