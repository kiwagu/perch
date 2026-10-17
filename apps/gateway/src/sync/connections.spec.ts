import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { ConnectionRegistry } from './connections'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

/** A connection that keeps what it is told of its identity's memberships and the regions taken from it. */
function connection() {
  const heard: Array<readonly Membership[]> = []
  const revoked: string[] = []

  return {
    heard,
    revoked,
    memberships: async (next: readonly Membership[]) => {
      heard.push(next)
    },
    revoke: async (region: string) => {
      revoked.push(region)
    },
  }
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

  it('tells and revokes on every live connection of the identity, and resolves once each has', async () => {
    const registry = new ConnectionRegistry()
    const ann = identityIdFactory.create()
    const laptop = connection()
    const phone = connection()
    const bobs = connection()

    registry.add(ann, laptop)
    registry.add(ann, phone)
    registry.add(identityIdFactory.create(), bobs)

    await registry.revoke(ann, 'tenant:acme')
    await registry.tell(ann, [acme])

    for (const device of [laptop, phone]) {
      expect(device.revoked).toEqual(['tenant:acme'])
      expect(device.heard).toEqual([[acme]])
    }

    expect(bobs.revoked).toEqual([])
    expect(bobs.heard).toEqual([])
    // An identity without connections has nothing to wait for.
    await expect(registry.revoke(identityIdFactory.create(), 'tenant:acme')).resolves.toBe(
      undefined,
    )
  })
})
