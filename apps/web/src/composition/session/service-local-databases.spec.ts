import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import { FakeLocks } from '@workspace/replica/testing'

import { fakeGatewayAuth } from '../__fixtures__/gateway-auth'
import {
  openTestWorld,
  signUpVerified,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import {
  type MemoryStorage,
  memoryStorage,
  pendingRevokes,
  saveDevice,
  saveTenantDatabases,
  signingOutSince,
} from '../storage'

import { addLeftoverIdentity, leftoverIdentities } from './leftover-identities'
import { spaceLockName } from './space-deletion'

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'Pass-word-2', name: 'Bob', locale: 'en' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A promise and the function that resolves it. */
function deferred() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((yes) => {
    resolve = yes
  })

  return { promise, resolve }
}

async function world(options: TestWorldOptions = {}): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/**
 * A tab that signed Ann up through the session and opened her link, and leads her sync with its
 * channel up; with the gateway's accounts.
 */
async function annSignedUp(options: Omit<TestWorldOptions, 'auth'> = {}) {
  const auth = fakeGatewayAuth()
  const tab = await world({ ...options, auth })

  expect((await signUpVerified(tab.session, auth, annSignUp)).isOk()).toBe(true)
  await vi.waitFor(() => expect(tab.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

  return { ...tab, accounts: auth, ann: tab.session.current() ?? expect.unreachable('signed in') }
}

describe('a delete another tab holds up', () => {
  it('ends the sign-out once the grace passed, with a word for the sign-in page, and lets the next account sign in', async () => {
    const held = deferred()
    const { session, storage, ann, accounts, driveClock } = await annSignedUp({
      heldDeletes: held.promise,
    })
    const heard: Array<string | undefined> = []

    // The tab hears the sign-out only once the sign-in page can read its word.
    session.subscribe((user) => heard.push(user ? 'signed in' : session.notice()))

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(heard).toEqual(['delete-pending'])
    expect(session.current()).toBeUndefined()
    expect(storage.get('perch.session.identity')).toBeUndefined()
    // The barrier over every tab's writes is down, and the delete goes on, listed.
    expect(signingOutSince(storage)).toBeUndefined()
    expect(leftoverIdentities(storage)).toEqual([ann.id])

    expect((await signUpVerified(session, accounts, bobSignUp)).isOk()).toBe(true)

    held.resolve()
    await vi.waitFor(() => expect(leftoverIdentities(storage)).toEqual([]))
  })

  it('has a sign-in as the same identity wait for that delete before it opens the database again', async () => {
    const held = deferred()
    const { session, storage, ann, driveClock, opened } = await annSignedUp({
      heldDeletes: held.promise,
    })

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    let back = false
    const again = session.signIn(annSignUp).andTee(() => {
      back = true
    })

    await settle()
    await settle()
    expect(back).toBe(false)
    expect(opened()).toEqual([ann.id])

    held.resolve()

    expect((await again).isOk()).toBe(true)
    expect(opened()).toEqual([ann.id, ann.id])
    expect(leftoverIdentities(storage)).toEqual([])
  })
})

describe('the next start', () => {
  /** A browser where a sign-out of `left` did not see its databases deleted. */
  function leftBehind(left = identityIdFactory.create()): MemoryStorage {
    const storage = memoryStorage()

    addLeftoverIdentity(storage, left)
    saveTenantDatabases(storage, left, ['acme'])

    return storage
  }

  it('deletes the databases a sign-out left behind, the organisation ones too', async () => {
    const left = identityIdFactory.create()
    const tab = await world({ storage: leftBehind(left) })

    expect((await tab.session.restore()).isOk()).toBe(true)

    await vi.waitFor(() => expect(leftoverIdentities(tab.storage)).toEqual([]))
    expect(tab.localsDeleted()).toEqual([left])
    expect(tab.tenantsDeletedOf(left)).toEqual(['acme'])
  })

  it('leaves alone the databases of the identity signed in on this browser, and lists it no more', async () => {
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const storage = leftBehind(ann.id)

    saveDevice(storage, { identity: ann, token: 'token-ann', memberships: [] })

    const tab = await world({ storage, online: false })

    expect((await tab.session.restore()).isOk()).toBe(true)
    await settle()

    expect(tab.localsDeleted()).toEqual([])
    expect(tab.opened()).toEqual([ann.id])
    expect(leftoverIdentities(storage)).toEqual([])
  })
})

describe('a saved identity whose database does not open', () => {
  const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }

  /** A browser where Ann is signed in and counts the database of her organisation `acme`. */
  function annSaved(): MemoryStorage {
    const storage = memoryStorage()

    saveDevice(storage, { identity: ann, token: 'token-ann', memberships: [] })
    saveTenantDatabases(storage, ann.id, ['acme'])

    return storage
  }

  it('signs out on this device: the token is left to sign out, and her databases deleted', async () => {
    const storage = annSaved()
    const tab = await world({ storage, online: false, refusedIdentities: [ann.id] })

    expect((await tab.session.restore())._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect((await tab.session.signOutUnopened(ann.id)).isOk()).toBe(true)

    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(pendingRevokes(storage).map(({ token }) => token)).toEqual(['token-ann'])
    expect(tab.localsDeleted()).toEqual([ann.id])
    expect(tab.tenantsDeletedOf(ann.id)).toEqual(['acme'])
    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('changes nothing while a space is open', async () => {
    const storage = annSaved()
    const tab = await world({ storage, online: false })

    expect((await tab.session.restore()).isOk()).toBe(true)
    expect((await tab.session.signOutUnopened(ann.id)).isOk()).toBe(true)

    expect(tab.session.current()?.id).toBe(ann.id)
    expect(storage.get('perch.session.identity')).toBeDefined()
    expect(tab.localsDeleted()).toEqual([])
  })
})

describe('two tabs, one identity being deleted and signed in again', () => {
  it("has the other tab's sign-in wait for the delete under way before it opens the databases again", async () => {
    const shared = { storage: memoryStorage(), locks: new FakeLocks(), auth: fakeGatewayAuth() }
    const held = deferred()
    const a = await world({ ...shared, online: false, heldDeletes: held.promise })
    const b = await world({ ...shared, online: false })

    expect((await signUpVerified(a.session, shared.auth, annSignUp)).isOk()).toBe(true)

    const ann = a.session.current() ?? expect.unreachable('signed in')

    expect((await a.driveClock(a.session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    let back = false
    const again = b.session.signIn(annSignUp).andTee(() => {
      back = true
    })

    // The other tab's open waits for the identity's lock, which the delete holds.
    await vi.waitFor(() =>
      expect(shared.locks.queue.map(({ name }) => name)).toContain(spaceLockName(ann.id)),
    )
    await settle()
    expect(back).toBe(false)
    expect(b.opened()).toEqual([])

    held.resolve()

    expect((await again).isOk()).toBe(true)
    expect(b.opened()).toEqual([ann.id])
    expect(leftoverIdentities(shared.storage)).toEqual([])
  })

  it('deletes nothing when the other tab signed the identity in again while this one was still closing', async () => {
    const shared = { storage: memoryStorage(), locks: new FakeLocks(), auth: fakeGatewayAuth() }
    const closing = deferred()
    const a = await world({
      ...shared,
      online: false,
      wrap: (local) => ({
        ...local,
        close: async () => {
          await closing.promise
          await local.close()
        },
      }),
    })
    const b = await world({ ...shared, online: false })

    expect((await signUpVerified(a.session, shared.auth, annSignUp)).isOk()).toBe(true)

    const ann = a.session.current() ?? expect.unreachable('signed in')
    const signingOut = a.driveClock(a.session.signOut())

    await vi.waitFor(() => expect(shared.storage.get('perch.session.identity')).toBeUndefined())
    expect((await b.session.signIn(annSignUp)).isOk()).toBe(true)

    closing.resolve()

    expect((await signingOut)._unsafeUnwrap()).toBe('signed-out')
    expect(a.destroyed()).toEqual([])
    expect(b.session.current()?.id).toBe(ann.id)
    expect(leftoverIdentities(shared.storage)).toEqual([])
  })
})
