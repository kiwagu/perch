import { afterEach, describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import { ConnectionRegistry } from './connections'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

/**
 * A connection that keeps what it is told of its identity's memberships, the regions taken from it
 * and the roles it was given; with `answered`, each call resolves only once that does, as a
 * device still busy would.
 */
function connection(answered: Promise<void> = Promise.resolve()) {
  const heard: Array<readonly Membership[]> = []
  const revoked: string[] = []
  const reroled: Array<readonly [string, TenantRole]> = []
  const ended: number[] = []
  const superseded = { count: 0 }

  return {
    heard,
    revoked,
    reroled,
    ended,
    superseded,
    supersede: () => {
      superseded.count += 1
    },
    memberships: async (next: readonly Membership[]) => {
      heard.push(next)
      await answered
    },
    revoke: async (region: string) => {
      revoked.push(region)
      await answered
    },
    rerole: async (region: string, role: TenantRole) => {
      reroled.push([region, role])
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
  it('supersedes the other connections of a device: closes them, keeps the one named, moves no epoch', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const bob = identityIdFactory.create()
    const older = connection()
    const newer = connection()
    const phone = connection()
    const bobs = connection()
    const epoch = registry.epoch()

    registry.add(ann, 'laptop', older, epoch)
    registry.add(ann, 'laptop', newer, epoch)
    registry.add(ann, 'phone', phone, registry.epoch())
    registry.add(bob, 'laptop', bobs, registry.epoch())
    registry.supersede(ann, 'laptop', newer)

    expect(older.superseded.count).toBe(1)
    expect([newer, phone, bobs].map((each) => each.superseded.count)).toEqual([0, 0, 0])
    expect(registry.epoch()).toBe(epoch)
  })

  it('answers add with a function that removes the connection', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const device = connection()
    const remove = registry.add(ann, 'device-laptop', device, registry.epoch())

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
    const removeLaptop = registry.add(ann, 'device-laptop', laptop, registry.epoch())

    registry.add(ann, 'device-phone', phone, registry.epoch())
    registry.add(bob, 'device-bobs', bobs, registry.epoch())
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

    registry.add(ann, 'device-laptop', laptop, registry.epoch())
    registry.add(ann, 'device-phone', phone, registry.epoch())
    const bob = identityIdFactory.create()

    registry.add(bob, 'device-bobs', bobs, registry.epoch())

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

  it('re-judges on every live connection of the identity, and resolves once each has', async () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const busy = deferred()
    const laptop = connection()
    const phone = connection(busy.promise)
    const bobs = connection()

    registry.add(ann, 'device-laptop', laptop, registry.epoch())
    registry.add(ann, 'device-phone', phone, registry.epoch())
    registry.add(identityIdFactory.create(), 'device-bobs', bobs, registry.epoch())

    const reroled = registry.rerole(ann, 'tenant:acme', 'admin')
    const rerolling = watch(reroled)

    // Both connections were reached at once, but the call resolves only once the busy one has.
    await settle()
    expect(laptop.reroled).toEqual([['tenant:acme', 'admin']])
    expect(phone.reroled).toEqual([['tenant:acme', 'admin']])
    expect(rerolling.resolved).toBe(false)

    busy.resolve()
    await reroled

    expect(bobs.reroled).toEqual([])
    // An identity without connections has nothing to wait for.
    await expect(
      registry.rerole(identityIdFactory.create(), 'tenant:acme', 'member'),
    ).resolves.toBe(undefined)
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

    registry.add(ann, 'device-laptop', laptop, registry.epoch())
    registry.add(ann, 'device-laptop', laptopAgain, registry.epoch())
    registry.add(ann, 'device-phone', phone, registry.epoch())
    registry.add(bob, 'device-laptop', bobs, registry.epoch())

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

    registry.add(ann, 'device-laptop', laptop, registry.epoch())
    registry.add(ann, 'device-phone', phone, registry.epoch())
    const bob = identityIdFactory.create()

    registry.add(bob, 'device-bobs', bobs, registry.epoch())

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
    const before = registry.epoch()

    void registry.close(ann, 'device-laptop', 4001)

    expect(registry.add(ann, 'device-laptop', laptop, before)).toBeUndefined()
    expect(registry.forIdentity(ann)).toEqual([])
    expect(typeof registry.add(ann, 'device-laptop', laptop, registry.epoch())).toBe('function')
  })

  it('refuses every device of an identity closed as a whole since the epoch was read, and only that identity', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const bob = identityIdFactory.create()
    const before = registry.epoch()

    void registry.close(ann, undefined, 4001)

    expect(registry.epoch()).not.toBe(before)
    expect(registry.add(ann, 'device-phone', connection(), before)).toBeUndefined()
    expect(registry.add(ann, 'device-tablet', connection(), before)).toBeUndefined()
    expect(registry.add(bob, 'device-phone', connection(), before)).toBeDefined()
  })

  it('refuses no other device of the identity on a close of one device', () => {
    const registry = registryHeard()
    const ann = identityIdFactory.create()
    const before = registry.epoch()

    void registry.close(ann, 'device-phone', 4001)

    expect(registry.add(ann, 'device-tablet', connection(), before)).toBeDefined()
    expect(registry.add(ann, 'device-phone', connection(), before)).toBeUndefined()
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

    registry.add(ann, 'device-laptop', broken, registry.epoch())
    registry.add(ann, 'device-phone', phone, registry.epoch())

    await expect(registry.close(ann, undefined, 4001)).resolves.toBe(undefined)
    expect(phone.ended).toEqual([4001])
    expect(reported.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })
})
