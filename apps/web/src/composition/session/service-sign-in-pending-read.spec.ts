import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { FakeLocks } from '@workspace/replica/testing'

import {
  type FakeGatewayAuth,
  fakeGatewayAuth,
  verifiedElsewhere,
} from '../__fixtures__/gateway-auth'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { sharedStorage } from '../__fixtures__/shared-storage'
import type { NamedDevice } from '../gateway-auth'
import {
  deviceIdFrom,
  pendingRevokes,
  savedIdentity,
  savedMemberships,
  savedTenantDatabases,
  savedToken,
  saveTenantDatabases,
} from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }
const bobSignUp = { email: 'bob@example.test', password: 'Pass-word-2', name: 'Bob', locale: 'en' }

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'admin',
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

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A memberships read the test answers itself, with the token and device it was asked with. */
interface PendingRead {
  readonly token: string
  readonly device: string
  answer(result: Result<readonly Membership[], DataError>): void
}

/** Memberships reads that wait for the test to answer them, oldest first. */
function deferredReads() {
  const pending: PendingRead[] = []

  return {
    pending,
    listMemberships: (token: string, device: string) =>
      new ResultAsync<readonly Membership[], DataError>(
        new Promise((resolve) => pending.push({ token, device, answer: resolve })),
      ),
  }
}

/** The gateway's sign-outs answer that it cannot be reached: a token left to sign out stays queued. */
function unreachableSignOuts(auth: FakeGatewayAuth): void {
  auth.answerSignOut(() => errAsync(dataError('data:OFFLINE', 'could not reach the gateway')))
}

/**
 * Makes `input`'s account at the gateway and verifies it from another device, which takes the
 * account's first session token, and answers its identity.
 */
async function accountOf(auth: FakeGatewayAuth, input: typeof annSignUp): Promise<IdentityId> {
  const made = (await verifiedElsewhere(auth, input))._unsafeUnwrap()

  auth.requests.splice(0)

  return made.id
}

describe("a sign-in whose memberships read is pending: nothing reaches the browser's storage", () => {
  it('publishes nothing until the read answers, so another tab neither opens nor deletes anything, then follows with the memberships read', async () => {
    const browser = sharedStorage()
    const auth = fakeGatewayAuth()
    const ann = await accountOf(auth, annSignUp)
    const reads = deferredReads()
    const shared = { auth, locks: new FakeLocks(), databases: browserDatabases(), online: false }
    const storage = browser.tab()

    // An earlier sign-out kept Ann's Acme database, which held changes not sent yet.
    saveTenantDatabases(storage, ann, ['acme'])

    const a = await world({ ...shared, storage, listMemberships: reads.listMemberships })
    const b = await world({ ...shared, storage: browser.tab(), gateway: a.gateway })

    expect((await b.session.restore()).isOk()).toBe(true)

    const signingIn = a.session.signIn(annSignUp)

    await vi.waitFor(() => expect(reads.pending).toHaveLength(1))
    await settle()

    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(storage.get('perch.session.token')).toBeUndefined()
    expect(b.session.current()).toBeUndefined()
    expect(b.opened()).toEqual([])

    reads.pending[0]?.answer(ok([acme]))

    expect((await signingIn)._unsafeUnwrap().id).toBe(ann)
    // The other tab follows the sign-in with the memberships it read, at once.
    await vi.waitFor(() => expect(b.session.current()?.id).toBe(ann))
    expect(b.session.memberships()).toEqual([acme])
    await settle()

    // Acme's database was never deleted, in either tab, and stays counted.
    for (const tab of [a, b]) {
      expect(tab.tenantsDeleted()).toEqual([])
      expect(tab.tenantsDestroyed()).toEqual([])
    }

    expect(savedTenantDatabases(storage, ann)).toEqual(['acme'])
  })

  // The sign-in lock keeps another tab's sign-in from running meanwhile; this checks the recheck
  // after the read on its own, with tabs whose locks do not hold each other back.
  it("leaves alone the account another tab signed in while the read was pending, refuses its own and signs that one's token out", async () => {
    const browser = sharedStorage()
    const auth = fakeGatewayAuth()
    const ann = await accountOf(auth, annSignUp)
    const bob = await accountOf(auth, bobSignUp)
    const reads = deferredReads()
    const shared = { auth, databases: browserDatabases(), online: false }
    const storage = browser.tab()

    unreachableSignOuts(auth)

    const a = await world({
      ...shared,
      storage,
      locks: new FakeLocks(),
      listMemberships: reads.listMemberships,
    })
    const b = await world({
      ...shared,
      storage: browser.tab(),
      locks: new FakeLocks(),
      gateway: a.gateway,
      listMemberships: () => okList([globex]),
    })

    const signingIn = a.session.signIn(annSignUp)

    await vi.waitFor(() => expect(reads.pending).toHaveLength(1))

    const annToken = reads.pending[0]?.token ?? expect.unreachable("Ann's read")

    // Meanwhile the other tab signs Bob in, whole.
    expect((await b.session.signIn(bobSignUp))._unsafeUnwrap().id).toBe(bob)

    const bobToken = savedToken(storage) ?? expect.unreachable("Bob's token")

    reads.pending[0]?.answer(ok([acme]))

    expect((await signingIn)._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    // Bob's session is untouched: his identity, token and memberships.
    expect(savedIdentity(storage)?.id).toBe(bob)
    expect(savedToken(storage)).toBe(bobToken)
    expect(savedMemberships(storage, bob)).toEqual([globex])
    expect(a.opened()).not.toContain(ann)
    // Ann's token, and only hers, waits to be signed out.
    expect(annToken).not.toBe(bobToken)
    expect(pendingRevokes(storage)).toEqual([{ token: annToken, device: deviceIdFrom(storage) }])
  })

  it('ignores a read that answers once the session closed, and signs its token out', async () => {
    const browser = sharedStorage()
    const auth = fakeGatewayAuth()

    await accountOf(auth, annSignUp)
    unreachableSignOuts(auth)

    const reads = deferredReads()
    const storage = browser.tab()
    const a = await world({ auth, storage, online: false, listMemberships: reads.listMemberships })
    const signingIn = a.session.signIn(annSignUp)

    await vi.waitFor(() => expect(reads.pending).toHaveLength(1))

    const token = reads.pending[0]?.token ?? expect.unreachable("Ann's read")

    await a.session.close()
    reads.pending[0]?.answer(ok([acme]))

    expect((await signingIn)._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedToken(storage)).toBeUndefined()
    expect(a.opened()).toEqual([])
    expect(pendingRevokes(storage)).toEqual([{ token, device: deviceIdFrom(storage) }])
  })

  it('signs out the token of a sign-in the gateway answers once the session closed', async () => {
    const browser = sharedStorage()
    const fake = fakeGatewayAuth()

    await accountOf(fake, annSignUp)
    unreachableSignOuts(fake)

    let asked = false
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    // The gateway answers the sign-in only once the test lets it.
    const auth = {
      ...fake,
      signIn: (input: typeof annSignUp, device: NamedDevice) => {
        asked = true

        return new ResultAsync(answered.then(() => fake.signIn(input, device)))
      },
    }
    const storage = browser.tab()
    const a = await world({ auth, storage, online: false })
    const signingIn = a.session.signIn(annSignUp)

    await vi.waitFor(() => expect(asked).toBe(true))
    await a.session.close()
    answer()

    expect((await signingIn)._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(savedToken(storage)).toBeUndefined()
    await vi.waitFor(() =>
      expect(pendingRevokes(storage)).toEqual([
        { token: 'token-2', device: deviceIdFrom(storage) },
      ]),
    )
  })

  it("leaves another tab's token alone when its own space then fails to open, and signs its own out", async () => {
    const browser = sharedStorage()
    const auth = fakeGatewayAuth()
    const ann = await accountOf(auth, annSignUp)
    let fail = () => {}
    const failing = new Promise<void>((resolve) => {
      fail = resolve
    })
    const storage = browser.tab()

    unreachableSignOuts(auth)

    // Ann's database opens only once the test lets it, and then fails.
    const a = await world({
      auth,
      storage,
      online: false,
      databases: {
        open: () =>
          new ResultAsync(
            failing.then(() => err(dataError('data:OPEN_FAILED', 'the browser would not open it'))),
          ),
      },
    })
    const signingIn = a.session.signIn(annSignUp)

    await vi.waitFor(() => expect(savedIdentity(storage)?.id).toBe(ann))

    const annToken = savedToken(storage) ?? expect.unreachable("Ann's token")

    // Another tab signs Ann in again meanwhile, with a token of its own.
    storage.changeElsewhere('perch.session.token', 'token-of-the-other-tab')
    fail()

    expect((await signingIn)._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect(savedToken(storage)).toBe('token-of-the-other-tab')
    expect(savedIdentity(storage)?.id).toBe(ann)
    expect(pendingRevokes(storage)).toEqual([{ token: annToken, device: deviceIdFrom(storage) }])
  })
})

describe("one sign-in at a time across the browser's tabs", () => {
  /** Two tabs of one browser sharing its storage and Web Locks; the first reads through `reads`. */
  async function twoTabs(auth: FakeGatewayAuth, reads: ReturnType<typeof deferredReads>) {
    const browser = sharedStorage()
    const shared = { auth, locks: new FakeLocks(), databases: browserDatabases(), online: false }
    const storage = browser.tab()
    const a = await world({ ...shared, storage, listMemberships: reads.listMemberships })
    const b = await world({
      ...shared,
      storage: browser.tab(),
      gateway: a.gateway,
      listMemberships: () => okList([]),
    })

    return { a, b, storage }
  }

  it("asks the gateway for a second tab's sign-in of the same account only once the first saved, and keeps the later token", async () => {
    const auth = fakeGatewayAuth()
    const ann = await accountOf(auth, annSignUp)
    const reads = deferredReads()
    const { a, b, storage } = await twoTabs(auth, reads)
    const first = a.session.signIn(annSignUp)

    await vi.waitFor(() => expect(reads.pending).toHaveLength(1))

    const second = b.session.signIn(annSignUp)

    // The second tab waits for the first: it has not asked the gateway yet.
    await settle()
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in'])

    reads.pending[0]?.answer(ok([]))

    expect((await first)._unsafeUnwrap().id).toBe(ann)

    const space = a.session.space() ?? expect.unreachable("the first tab's space")
    const firstToken = reads.pending[0]?.token

    expect((await second)._unsafeUnwrap().id).toBe(ann)
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in', 'sign-in'])
    // The later token is the one kept: the gateway's later sign-in ended the device's earlier one.
    expect(savedToken(storage)).toBe('token-3')
    expect(firstToken).toBe('token-2')
    await settle()
    // The first tab's space is open as it was.
    expect(a.session.current()?.id).toBe(ann)
    expect(a.session.space()).toBe(space)
    expect(pendingRevokes(storage)).toEqual([])
  })

  it.each([
    ['a failed read', 'data:OFFLINE'],
    ['a session closed meanwhile', 'data:AUTH_FAILED'],
    ['a throw of the auth call', 'data:AUTH_FAILED'],
  ] as const)('lets the lock go after %s: the next sign-in is not held back', async (way, code) => {
    const fake = fakeGatewayAuth()

    await accountOf(fake, annSignUp)
    unreachableSignOuts(fake)

    const reads = deferredReads()
    const auth =
      way === 'a throw of the auth call'
        ? {
            ...fake,
            signIn: () => {
              throw new Error('the auth client broke')
            },
          }
        : fake
    const browser = sharedStorage()
    const locks = new FakeLocks()
    const databases = browserDatabases()
    const a = await world({
      auth,
      locks,
      databases,
      storage: browser.tab(),
      online: false,
      listMemberships: reads.listMemberships,
    })
    const b = await world({
      auth: fake,
      locks,
      databases,
      storage: browser.tab(),
      gateway: a.gateway,
      online: false,
      listMemberships: () => okList([]),
    })
    const first = a.session.signIn(annSignUp)

    if (way === 'a failed read') {
      await vi.waitFor(() => expect(reads.pending).toHaveLength(1))
      reads.pending[0]?.answer(err(dataError('data:OFFLINE', 'could not reach the gateway')))
    } else if (way === 'a session closed meanwhile') {
      await vi.waitFor(() => expect(reads.pending).toHaveLength(1))
      await a.session.close()
      reads.pending[0]?.answer(ok([]))
    }

    expect((await first)._unsafeUnwrapErr().code).toBe(code)
    expect((await b.session.signIn(annSignUp)).isOk()).toBe(true)
  })
})

/** A memberships read that answers `memberships` at once. */
function okList(memberships: readonly Membership[]) {
  return new ResultAsync<readonly Membership[], DataError>(Promise.resolve(ok(memberships)))
}
