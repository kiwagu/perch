import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { type IdentityId, identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { writeLockName } from '@workspace/replica/sync'
import { FakeLocks } from '@workspace/replica/testing'

import {
  type FakeGatewayAuth,
  fakeGatewayAuth,
  verifiedElsewhere,
} from '../__fixtures__/gateway-auth'
import { type LaggingStorage, laggingStorage } from '../__fixtures__/lagging-storage'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { signedIn, signedOut } from '../__fixtures__/signed-in'
import {
  type KeptSession,
  type KeyValueStorage,
  keptAccountStart,
  pendingRevokes,
  savedIdentity,
  savedMemberships,
  savedRoles,
  savedTenant,
  savedToken,
  saveRoles,
  saveTenant,
} from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'Pass-word-2', name: 'Bob', locale: 'en' }

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

async function world(options: TestWorldOptions): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/** Makes `input`'s account at the gateway, verified from another device, and answers it. */
async function accountOf(auth: FakeGatewayAuth, input: typeof annSignUp): Promise<AuthUser> {
  const made = (await verifiedElsewhere(auth, input))._unsafeUnwrap()

  auth.requests.splice(0)

  return made
}

/** Another tab of the browser signs the account it saw out, as its sign-out leaves the storage. */
function signedOutElsewhere(tab: KeyValueStorage): void {
  signedOut(tab)
}

/**
 * Another tab of the browser signs `identity` in with `token`, as its sign-in leaves the storage;
 * answers the sign-in's session.
 */
function signedInElsewhere(tab: KeyValueStorage, identity: AuthUser, token: string): KeptSession {
  return signedIn(tab, { identity, token })
}

/** The tokens left to sign out on this browser, and those the gateway was asked to sign out. */
function revoked(auth: FakeGatewayAuth, tab: KeyValueStorage): string[] {
  return [
    ...pendingRevokes(tab).map(({ token }) => token),
    ...auth.requests.flatMap((request) => (request.kind === 'sign-out' ? [request.token] : [])),
  ]
}

/** Holds `identity`'s write lock exclusively, as another tab's sign-out does; the returned function lets go. */
function holdWriteLock(locks: FakeLocks, identity: IdentityId): () => void {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  void locks.request(writeLockName(identity), { mode: 'exclusive' }, () => held)

  return release
}

/**
 * Resolves once the transitions the session queued so far ran: it queues one more, the sign-out
 * offered for a space that did not open, which changes nothing while a space is open or nobody is.
 */
function transitionsRan(world: TestWorld): Promise<unknown> {
  const nobody: KeptSession = { signIn: 'nobody', identity: identityIdFactory.create(), token: '' }

  return Promise.resolve(world.session.signOutUnopened(nobody))
}

/**
 * One browser, offline, whose two tabs hear each other's writes only when the test delivers them:
 * tab `a` with a session, the other one a storage another tab writes through.
 */
async function browserOf(options: Partial<TestWorldOptions> = {}) {
  const browser: LaggingStorage = laggingStorage()
  const auth = fakeGatewayAuth()
  const locks = new FakeLocks()
  const ann = await accountOf(auth, annSignUp)
  const a = await world({
    auth,
    locks,
    databases: browserDatabases(),
    online: false,
    storage: browser.tab(),
    ...options,
  })
  const other = browser.tab()

  expect((await a.session.restore()).isOk()).toBe(true)

  return { browser, auth, locks, ann, a, other }
}

describe('an ending that began with one sign-in, while another tab signs the next one in', () => {
  it("leaves the next account's sign-in alone when a tab that has not heard of it signs out", async () => {
    const { browser, auth, ann, a, other } = await browserOf()
    const bob = await accountOf(auth, bobSignUp)

    expect((await a.session.signIn(annSignUp)).isOk()).toBe(true)
    browser.deliver()

    // Another tab signs Ann out and Bob in; this tab, still showing Ann, has heard none of it.
    signedOutElsewhere(other)
    signedInElsewhere(other, bob, 'token-bob')

    expect((await a.driveClock(a.session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    browser.deliver()

    expect(savedIdentity(other)?.id).toBe(bob.id)
    expect(savedToken(other)).toBe('token-bob')
    expect(revoked(auth, other)).not.toContain('token-bob')
    // This tab follows Bob, signed in on the browser.
    await vi.waitFor(() => expect(a.session.current()?.id).toBe(bob.id))
    expect(ann.id).not.toBe(bob.id)
  })

  it.each([
    ['another account', 'bob'],
    ['the same account again', 'ann'],
  ] as const)(
    'removes and revokes nothing of %s signed in elsewhere while its sign-out waited',
    async (_, who) => {
      const { browser, auth, locks, ann, a, other } = await browserOf()
      const next = who === 'bob' ? await accountOf(auth, bobSignUp) : ann

      expect((await a.session.signIn(annSignUp)).isOk()).toBe(true)
      browser.deliver()

      // The sign-out waits for Ann's write lock, which another tab's sign-out holds.
      const release = holdWriteLock(locks, ann.id)
      const signingOut = a.session.signOut()

      await vi.waitFor(() => expect(locks.waiting(writeLockName(ann.id), 'exclusive')).toBe(true))

      // Meanwhile that tab signs Ann out and the next sign-in in, and this tab hears it all.
      signedOutElsewhere(other)
      signedInElsewhere(other, next, 'token-next')
      browser.deliver()
      release()

      expect((await a.driveClock(signingOut))._unsafeUnwrap()).toBe('signed-out')
      browser.deliver()

      expect(savedIdentity(other)?.id).toBe(next.id)
      expect(savedToken(other)).toBe('token-next')
      expect(revoked(auth, other)).not.toContain('token-next')
    },
  )

  it("leaves what Ann's later sign-in keeps alone when a tab that has not heard of it ends her earlier one", async () => {
    const { browser, ann, a, other } = await browserOf()

    expect((await a.session.signIn(annSignUp)).isOk()).toBe(true)
    browser.deliver()

    // Another tab signs Ann out and in again, and keeps what that sign-in has; this tab heard none of it.
    signedOutElsewhere(other)

    const again = signedIn(other, { identity: ann, token: 'token-ann-2', memberships: [acme] })

    saveRoles(other, again, ['operator'])
    keptAccountStart(other).keep(again.signIn, { identity: ann.id, name: 'Ann', locale: 'en' })
    saveTenant(other, again.signIn, 'acme')

    expect((await a.driveClock(a.session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    browser.deliver()

    expect(savedToken(other)).toBe('token-ann-2')
    expect(savedMemberships(other, again)).toEqual([acme])
    expect(savedRoles(other, again)).toEqual(['operator'])
    expect(keptAccountStart(other).kept(ann.id)?.signIn).toBe(again.signIn)
    expect(savedTenant(other, again.signIn)).toBe('acme')
  })

  it("leaves Ann's later sign-in alone when the channel of her earlier one is refused", async () => {
    const { browser, auth, ann, a, other } = await browserOf()

    expect((await a.session.signIn(annSignUp)).isOk()).toBe(true)
    browser.deliver()

    const channel = a.contexts().at(-1)

    expect(channel).toBeDefined()

    // Another tab signs Ann out and in again; this tab hears it, then its old channel is refused.
    signedOutElsewhere(other)
    signedInElsewhere(other, ann, 'token-ann-2')
    browser.deliver()
    channel?.onEnded('unauthorized')

    await a.driveClock(transitionsRan(a))
    browser.deliver()

    expect(a.session.current()?.id).toBe(ann.id)

    expect(savedIdentity(other)?.id).toBe(ann.id)
    expect(savedToken(other)).toBe('token-ann-2')
    expect(revoked(auth, other)).not.toContain('token-ann-2')
  })

  it("leaves Ann's later sign-in alone when the sign-out offered for her unopened space runs late", async () => {
    const browser = laggingStorage()
    const auth = fakeGatewayAuth()
    const ann = await accountOf(auth, annSignUp)
    const tab = browser.tab()
    const other = browser.tab()

    const restoring = signedInElsewhere(tab, ann, 'token-ann')

    browser.deliver()

    // This tab cannot open Ann's database: the start offers to sign her out here.
    const a = await world({
      auth,
      databases: browserDatabases(),
      online: false,
      storage: tab,
      refusedIdentities: [ann.id],
    })

    expect((await a.session.restore()).isErr()).toBe(true)

    // Another tab signs Ann out and in again before this tab heard of it; then the offer is taken.
    signedOutElsewhere(other)
    signedInElsewhere(other, ann, 'token-ann-2')
    expect((await a.driveClock(a.session.signOutUnopened(restoring))).isOk()).toBe(true)
    browser.deliver()

    expect(savedIdentity(other)?.id).toBe(ann.id)
    expect(savedToken(other)).toBe('token-ann-2')
    expect(revoked(auth, other)).not.toContain('token-ann-2')
  })
})

describe('a sign-in whose space did not open, cleaned up after another tab signed the next account in', () => {
  it.each([
    ['before this tab heard of it', false],
    ['once this tab heard of it', true],
  ] as const)(
    "lets go of its own token and leaves the next account's sign-in alone, %s",
    async (_, heard) => {
      let failing: Promise<void> | undefined
      let fail = () => {}
      const browser = laggingStorage()
      const auth = fakeGatewayAuth()
      const ann = await accountOf(auth, annSignUp)
      const bob = await accountOf(auth, bobSignUp)
      const other = browser.tab()
      const a = await world({
        auth,
        databases: browserDatabases(),
        online: false,
        storage: browser.tab(),
        // Ann's space loads its regions only once the test lets it fail.
        wrap: (local) =>
          interceptQueries(local, async (text) => {
            if (failing && text.includes('FROM _replica_snapshot')) {
              await failing
              throw new Error('the region would not load')
            }
          }),
      })

      expect((await a.session.restore()).isOk()).toBe(true)

      failing = new Promise((resolve) => {
        fail = resolve
      })

      const signingIn = a.session.signIn(annSignUp)

      await vi.waitFor(() => expect(savedIdentity(a.storage)?.id).toBe(ann.id))

      // Another tab hears Ann's sign-in, signs her out and Bob in, before Ann's space fails to open.
      const elsewhere = browser.tab()

      signedOutElsewhere(elsewhere)
      signedInElsewhere(elsewhere, bob, 'token-bob')

      if (heard) {
        browser.deliver()
      }

      fail()

      expect((await signingIn).isErr()).toBe(true)
      browser.deliver()

      expect(savedIdentity(other)?.id).toBe(bob.id)
      expect(savedToken(other)).toBe('token-bob')
      expect(revoked(auth, other)).not.toContain('token-bob')
      // Ann's token, which the attempt did not keep, is left to sign out.
      expect(pendingRevokes(other)).toHaveLength(1)
    },
  )
})
