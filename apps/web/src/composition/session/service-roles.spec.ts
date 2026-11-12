import { afterEach, describe, expect, it, vi } from 'vitest'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'
import { FakeLocks } from '@workspace/replica/testing'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { sharedStorage } from '../__fixtures__/shared-storage'
import { signedIn } from '../__fixtures__/signed-in'
import {
  isRolesKey,
  type KeptDevice,
  type MemoryStorage,
  memoryStorage,
  newSignInId,
  rolesKeyOf,
  savedRoles,
  savedSession,
  saveRoles,
} from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const bob: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  token: 'token-bob',
  memberships: [],
}

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

async function world(options: TestWorldOptions): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** What a session's role listeners heard, oldest first. */
function rolesHeard(session: TestWorld['session']): Array<readonly PlatformRole[]> {
  const heard: Array<readonly PlatformRole[]> = []

  session.onRoles((roles) => heard.push([...roles]))

  return heard
}

/** The writes of roles records a tab made on its storage, by key. */
function roleWrites(storage: MemoryStorage): () => string[] {
  const set = vi.spyOn(storage, 'set')
  const remove = vi.spyOn(storage, 'remove')

  return () =>
    [...set.mock.calls.map(([key]) => key), ...remove.mock.calls.map(([key]) => key)].filter(
      isRolesKey,
    )
}

/** The welcome of the channel `tab` leads carries `roles`: its transport hands them on. */
function welcomed(tab: TestWorld, roles: readonly PlatformRole[]): void {
  const context = tab.contexts().at(-1) ?? expect.unreachable('a channel')

  context.onRoles(roles)
}

/**
 * Ann signed in on a browser with two tabs on its storage, offline: tab A leads her sync and
 * holds the channel, tab B follows.
 */
async function annInTwoTabs() {
  const browser = sharedStorage()
  const shared = { locks: new FakeLocks(), databases: browserDatabases(), online: false }
  const storageA = browser.tab()
  const anns = signedIn(storageA, ann)

  const a = await world({ ...shared, storage: storageA })

  expect((await a.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(a.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

  const storageB = browser.tab()
  const b = await world({ ...shared, storage: storageB, gateway: a.gateway })

  expect((await b.session.restore()).isOk()).toBe(true)
  expect(b.session.current()?.id).toBe(ann.identity.id)

  return { browser, a, b, storageA, storageB, anns }
}

describe("the account's platform roles, from the leading tab's welcome", () => {
  it('the leading tab keeps the roles a welcome carries, and a following tab follows them by the storage event without reconnecting', async () => {
    const { a, b, storageA, storageB, anns } = await annInTwoTabs()
    const heardA = rolesHeard(a.session)
    const heardB = rolesHeard(b.session)
    const writesB = roleWrites(storageB)
    const channels = { a: a.contexts().length, b: b.contexts().length }

    welcomed(a, ['operator'])

    expect(savedRoles(storageA, anns)).toEqual(['operator'])
    expect([...a.session.roles()]).toEqual(['operator'])
    expect(heardA).toEqual([['operator']])

    await vi.waitFor(() => expect(heardB).toEqual([['operator']]))
    expect([...b.session.roles()]).toEqual(['operator'])
    // The following tab reads and tells: it writes no record, and no channel opens again.
    expect(writesB()).toEqual([])
    expect(b.contexts()).toHaveLength(channels.b)
    expect(a.contexts()).toHaveLength(channels.a)
  })

  it('takes the role away in both tabs when a later welcome does not carry it', async () => {
    const { a, b, storageA, anns } = await annInTwoTabs()
    const heardB = rolesHeard(b.session)

    welcomed(a, ['operator'])
    await vi.waitFor(() => expect(heardB).toEqual([['operator']]))

    // The leading tab connects again: the gateway's welcome carries no role.
    a.transports().at(-1)?.goOnline()

    await vi.waitFor(() => expect(savedRoles(storageA, anns)).toEqual([]))
    expect(storageA.get(rolesKeyOf(anns.signIn))).toBeDefined()
    expect(a.session.roles().size).toBe(0)
    await vi.waitFor(() => expect(heardB.at(-1)).toEqual([]))
    expect(b.session.roles().size).toBe(0)
  })

  it('a sign-in keeps no role: the first welcome of its channel does', async () => {
    const auth = fakeGatewayAuth()
    const input = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
    const identity = (await verifiedElsewhere(auth, input))._unsafeUnwrap().id
    const storage = memoryStorage()
    const tab = await world({ auth, storage, online: false })

    expect((await tab.session.restore()).isOk()).toBe(true)

    const heard = rolesHeard(tab.session)
    const writes = roleWrites(storage)

    expect((await tab.session.signIn(input))._unsafeUnwrap().id).toBe(identity)
    await vi.waitFor(() => expect(tab.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

    const kept = savedSession(storage) ?? expect.unreachable('the sign-in saved')

    expect(writes()).toEqual([])
    expect(storage.get(rolesKeyOf(kept.signIn))).toBeUndefined()
    expect(tab.session.roles().size).toBe(0)
    expect(heard.every((roles) => roles.length === 0)).toBe(true)

    welcomed(tab, ['operator'])

    expect(writes()).toEqual([rolesKeyOf(kept.signIn)])
    expect(savedRoles(storage, kept)).toEqual(['operator'])
    expect([...tab.session.roles()]).toEqual(['operator'])
    expect(heard.at(-1)).toEqual(['operator'])
  })

  it('restores the roles kept for the saved identity with it, while its space opens and after', async () => {
    const storage = memoryStorage()

    saveRoles(storage, signedIn(storage, ann), ['operator'])

    const tab = await world({ storage, online: false })
    const writes = roleWrites(storage)
    const restoring = tab.session.restore()

    expect(tab.session.current()?.id).toBe(ann.identity.id)
    expect([...tab.session.roles()]).toEqual(['operator'])
    expect((await restoring).isOk()).toBe(true)
    expect([...tab.session.roles()]).toEqual(['operator'])
    expect(writes()).toEqual([])
  })

  it('removes the roles at sign-out, and every tab hears the empty set', async () => {
    const { a, b, storageA, anns } = await annInTwoTabs()

    welcomed(a, ['operator'])
    await vi.waitFor(() => expect([...b.session.roles()]).toEqual(['operator']))

    const heardA = rolesHeard(a.session)
    const heardB = rolesHeard(b.session)

    expect((await a.driveClock(a.session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    expect(storageA.get(rolesKeyOf(anns.signIn))).toBeUndefined()
    expect(a.session.roles().size).toBe(0)
    expect(heardA.at(-1)).toEqual([])
    await vi.waitFor(() => expect(b.session.current()).toBeUndefined())
    await vi.waitFor(() => expect(heardB.at(-1)).toEqual([]))
    expect(b.session.roles().size).toBe(0)
  })

  it('writes nothing for a welcome that lands once its identity signed out', async () => {
    const { a, storageA, anns } = await annInTwoTabs()
    const context = a.contexts().at(-1) ?? expect.unreachable('a channel')

    expect((await a.driveClock(a.session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    const writes = roleWrites(storageA)

    context.onRoles(['operator'])

    expect(writes()).toEqual([])
    expect(storageA.get(rolesKeyOf(anns.signIn))).toBeUndefined()
    expect(a.session.roles().size).toBe(0)
  })

  it('writes nothing for a welcome that lands once another tab signed another account in', async () => {
    const { browser, a, storageA, anns } = await annInTwoTabs()
    const context = a.contexts().at(-1) ?? expect.unreachable('a channel')
    const writes = roleWrites(storageA)

    // Another tab signs Ann out and Bob in; this tab has not heard of it yet.
    const bobs = signedIn(browser.tab(), bob)

    context.onRoles(['operator'])

    expect(writes()).toEqual([])
    expect(storageA.get(rolesKeyOf(anns.signIn))).toBeUndefined()
    expect(storageA.get(rolesKeyOf(bobs.signIn))).toBeUndefined()
    await settle()
  })

  it('has a following tab show the saved roles of the identity another tab signed in, telling its listeners and writing no record', async () => {
    const { browser, a, b, storageB } = await annInTwoTabs()

    // Ann's welcome carried no role.
    welcomed(a, [])
    await settle()

    const heardB = rolesHeard(b.session)
    const writesB = roleWrites(storageB)

    expect(b.session.roles().size).toBe(0)

    // Another tab signs Ann out and Bob in, and keeps his record, which holds the operator's role,
    // before this tab hears any of it.
    const other = browser.tab()

    saveRoles(other, signedIn(other, bob), ['operator'])

    await vi.waitFor(() => expect(b.session.current()?.id).toBe(bob.identity.id))
    expect([...b.session.roles()]).toEqual(['operator'])
    await vi.waitFor(() => expect(heardB.at(-1)).toEqual(['operator']))
    expect(writesB()).toEqual([])
    await vi.waitFor(() => expect(a.session.current()?.id).toBe(bob.identity.id))
  })

  it('drops a role from the record of the identity a refusal names, and every tab hears it', async () => {
    const { a, b, storageA, anns } = await annInTwoTabs()

    welcomed(a, ['operator'])
    await vi.waitFor(() => expect([...b.session.roles()]).toEqual(['operator']))

    const heardA = rolesHeard(a.session)
    const heardB = rolesHeard(b.session)

    b.session.dropRole(ann.identity.id, 'operator')

    expect(savedRoles(storageA, anns)).toEqual([])
    expect(b.session.roles().size).toBe(0)
    expect(heardB).toEqual([[]])
    await vi.waitFor(() => expect(heardA).toEqual([[]]))
    expect(a.session.roles().size).toBe(0)
  })

  it('drops nothing of the identity shown for a refusal of another identity, and creates no record', async () => {
    const { a, storageA, anns } = await annInTwoTabs()

    welcomed(a, ['operator'])

    const writes = roleWrites(storageA)

    a.session.dropRole(bob.identity.id, 'operator')

    expect(savedRoles(storageA, anns)).toEqual(['operator'])
    expect([...a.session.roles()]).toEqual(['operator'])
    expect(writes()).toEqual([])
  })

  it("never reads another identity's record as the signed-in identity's", async () => {
    const { b, storageB } = await annInTwoTabs()
    const heard = rolesHeard(b.session)
    const other: IdentityId = bob.identity.id
    const bobs = { signIn: newSignInId(), identity: other }

    // The record of a sign-in of Bob, kept on the browser, and changed by another tab.
    saveRoles(storageB, bobs, ['operator'])
    storageB.changeElsewhere(rolesKeyOf(bobs.signIn), storageB.get(rolesKeyOf(bobs.signIn)))

    expect(b.session.roles().size).toBe(0)
    expect(heard.every((roles) => roles.length === 0)).toBe(true)
  })
})
