import { afterEach, describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
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
  const ended: number[] = []

  return {
    heard,
    revoked,
    ended,
    memberships: async (next: readonly Membership[]) => {
      heard.push(next)
      await answered
    },
    revoke: async (region: string) => {
      revoked.push(region)
      await answered
    },
    end: async (code: number) => {
      ended.push(code)
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

/** Failures the registries reported; a test that expects one takes it. */
const reported: DataError[] = []

afterEach(() => {
  expect(reported.splice(0)).toEqual([])
})

/** A registry whose failures go to `reported`. */
function registryHeard(): ConnectionRegistry {
  return new ConnectionRegistry({ onFailure: (error) => reported.push(error) })
}

describe('ConnectionRegistry', () => {
  it('answers add with a function that removes the connection', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const device = connection()
    const remove = registry.add(ann, 'device-laptop', device, registry.epoch(ann, 'device-laptop'))

    expect(registry.forIdentity(ann)).toEqual([device])

    remove?.()
    remove?.()

    expect(registry.forIdentity(ann)).toEqual([])
  })

  it('answers forIdentity with the live connections of that identity only', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const bob = identityIdFactory.create()
    const laptop = connection()
    const phone = connection()
    const bobs = connection()
    const removeLaptop = registry.add(
      ann,
      'device-laptop',
      laptop,
      registry.epoch(ann, 'device-laptop'),
    )

    registry.add(ann, 'device-phone', phone, registry.epoch(ann, 'device-phone'))
    registry.add(bob, 'device-bobs', bobs, registry.epoch(bob, 'device-bobs'))
    removeLaptop?.()

    expect(registry.forIdentity(ann)).toEqual([phone])
    expect(registry.forIdentity(bob)).toEqual([bobs])
    expect(registry.forIdentity(identityIdFactory.create())).toEqual([])
  })

  it('tells and revokes on every live connection of the identity, and resolves once each has', async () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const busy = deferred()
    const laptop = connection()
    const phone = connection(busy.promise)
    const bobs = connection()

    registry.add(ann, 'device-laptop', laptop, registry.epoch(ann, 'device-laptop'))
    registry.add(ann, 'device-phone', phone, registry.epoch(ann, 'device-phone'))
    const bob = identityIdFactory.create()

    registry.add(bob, 'device-bobs', bobs, registry.epoch(bob, 'device-bobs'))

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

  it('ends the connections of the named device of the identity only, and resolves once each has', async () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const bob = identityIdFactory.create()
    const busy = deferred()
    const laptop = connection(busy.promise)
    const laptopAgain = connection()
    const phone = connection()
    const bobs = connection()

    registry.add(ann, 'device-laptop', laptop, registry.epoch(ann, 'device-laptop'))
    registry.add(ann, 'device-laptop', laptopAgain, registry.epoch(ann, 'device-laptop'))
    registry.add(ann, 'device-phone', phone, registry.epoch(ann, 'device-phone'))
    registry.add(bob, 'device-laptop', bobs, registry.epoch(bob, 'device-laptop'))

    const closed = registry.close(ann, 'device-laptop', 4001)
    const closing = watch(closed)

    await settle()
    expect(laptop.ended).toEqual([4001])
    expect(laptopAgain.ended).toEqual([4001])
    expect(closing.resolved).toBe(false)

    busy.resolve()
    await closed

    expect(phone.ended).toEqual([])
    expect(bobs.ended).toEqual([])
  })

  it('ends every connection of the identity when no device is named', async () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const laptop = connection()
    const phone = connection()
    const bobs = connection()

    registry.add(ann, 'device-laptop', laptop, registry.epoch(ann, 'device-laptop'))
    registry.add(ann, 'device-phone', phone, registry.epoch(ann, 'device-phone'))
    const bob = identityIdFactory.create()

    registry.add(bob, 'device-bobs', bobs, registry.epoch(bob, 'device-bobs'))

    await registry.close(ann, undefined, 4001)

    expect(laptop.ended).toEqual([4001])
    expect(phone.ended).toEqual([4001])
    expect(bobs.ended).toEqual([])
    await expect(registry.close(identityIdFactory.create(), undefined, 4001)).resolves.toBe(
      undefined,
    )
  })

  it('refuses a connection whose device was closed since its epoch was read, and takes it once read again', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const laptop = connection()
    const before = registry.epoch(ann, 'device-laptop')

    void registry.close(ann, 'device-laptop', 4001)

    expect(registry.add(ann, 'device-laptop', laptop, before)).toBeUndefined()
    expect(registry.forIdentity(ann)).toEqual([])
    expect(
      typeof registry.add(ann, 'device-laptop', laptop, registry.epoch(ann, 'device-laptop')),
    ).toBe('function')
  })

  it("moves every device's epoch on a close of the whole identity, and only that identity's", () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const bob = identityIdFactory.create()
    const anns = registry.epoch(ann, 'device-phone')
    const phones = registry.epoch(ann, 'device-phone')
    const bobs = registry.epoch(bob, 'device-phone')

    void registry.close(ann, undefined, 4001)

    expect(registry.epoch(ann, 'device-phone')).not.toBe(anns)
    expect(registry.add(ann, 'device-phone', connection(), phones)).toBeUndefined()
    expect(registry.add(bob, 'device-phone', connection(), bobs)).toBeDefined()
    // A close of one device leaves another device's epoch where it was.
    const tablet = registry.epoch(ann, 'device-tablet')

    void registry.close(ann, 'device-phone', 4001)

    expect(registry.epoch(ann, 'device-tablet')).toBe(tablet)
  })

  it('reports a connection whose end throws, and still ends the others', async () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const broken = {
      ...connection(),
      end: (): Promise<void> => {
        throw new Error('the socket is gone')
      },
    }
    const phone = connection()

    registry.add(ann, 'device-laptop', broken, registry.epoch(ann, 'device-laptop'))
    registry.add(ann, 'device-phone', phone, registry.epoch(ann, 'device-phone'))

    await expect(registry.close(ann, undefined, 4001)).resolves.toBe(undefined)
    expect(phone.ended).toEqual([4001])
    expect(reported.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })
})
