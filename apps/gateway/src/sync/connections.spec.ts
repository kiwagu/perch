import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { ConnectionRegistry } from './connections'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

/**
 * A connection that keeps what it is told of its identity's memberships and the regions taken
 * from it; with `answered`, each call resolves only once that does, as a device still busy would.
 */
function connection(answered: Promise<void> = Promise.resolve()) {
  const heard: Array<readonly Membership[]> = []
  const revoked: string[] = []

  return {
    heard,
    revoked,
    memberships: async (next: readonly Membership[]) => {
      heard.push(next)
      await answered
    },
    revoke: async (region: string) => {
      revoked.push(region)
      await answered
    },
  }
}

/** A promise and the function that resolves it. */
function deferred() {
  let resolve = () => {}
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })

  return { promise, resolve: () => resolve() }
}

/** Whether `promise` has resolved yet. */
function watch(promise: Promise<void>) {
  const state = { resolved: false }

  void promise.then(() => {
    state.resolved = true
  })

  return state
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

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
    const busy = deferred()
    const laptop = connection()
    const phone = connection(busy.promise)
    const bobs = connection()

    registry.add(ann, laptop)
    registry.add(ann, phone)
    registry.add(identityIdFactory.create(), bobs)

    const revoked = registry.revoke(ann, 'tenant:acme')
    const told = registry.tell(ann, [acme])
    const revoking = watch(revoked)
    const telling = watch(told)

    // Both connections were reached at once, but neither call resolves while the phone is busy.
    await settle()
    expect(laptop.revoked).toEqual(['tenant:acme'])
    expect(phone.revoked).toEqual(['tenant:acme'])
    expect(revoking.resolved).toBe(false)
    expect(telling.resolved).toBe(false)

    busy.resolve()
    await revoked
    await told

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
