import { err, errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { fakeFetch, respond } from '../__fixtures__/gateway-fetch'
import {
  type BrowserDatabases,
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { organisationsApi } from '../organisations-api'
import {
  deviceIdFrom,
  type MemoryStorage,
  memoryStorage,
  pendingRevokes,
  savedIdentity,
  savedMemberships,
  savedToken,
} from '../storage'

const annSignUp = { email: 'ann@example.test', password: 'pass-word-1', name: 'Ann', locale: 'en' }

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

/**
 * The session token these sign-ins are given: the fake gateway issues the first to the device
 * that opened the account's link elsewhere, the second to the sign-in.
 */
const ISSUED = 'token-2'

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

async function world(options: TestWorldOptions): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/**
 * The memberships read as the root wires it: the organisation route, with the token the sign-in
 * was given and the device it named.
 */
function readThrough(fetcher: ReturnType<typeof fakeFetch>['fetcher']) {
  return (token: string, device: string) =>
    organisationsApi('https://app.example.test/backend', {
      token: () => token,
      device: () => device,
      fetcher,
    }).list()
}

/** What the gateway answers the memberships read: a refusal, a malformed list, or nothing at all. */
const failedReads = [
  ['refused', respond(401, { code: 'unauthorized' }), 'data:AUTH_FAILED'],
  ['malformed', respond(200, { memberships: [{ tenant: { key: 'acme' } }] }), 'data:AUTH_FAILED'],
  ['out of reach', () => Promise.reject(new TypeError('Failed to fetch')), 'data:OFFLINE'],
] as const

/** Nobody is signed in on the browser, and nothing of the sign-in's token is kept but its revoke. */
function expectNobodySaved(storage: MemoryStorage): void {
  expect(savedIdentity(storage)).toBeUndefined()
  expect(savedToken(storage)).toBeUndefined()
}

const unreachable = (): DataError => dataError('data:OFFLINE', 'could not reach the gateway')

/**
 * A browser storage that throws once on each write named (a `set` of a key, after the writes
 * before it landed, or a `remove`), and lists every write asked, the ones that threw included.
 */
function brokenStorage(throwing: {
  readonly set?: readonly string[]
  readonly remove?: readonly string[]
}): { readonly storage: MemoryStorage; readonly ops: readonly string[] } {
  const memory = memoryStorage()
  const ops: string[] = []
  const sets = new Set(throwing.set)
  const removes = new Set(throwing.remove)

  return {
    ops,
    storage: {
      ...memory,
      set: (key, value) => {
        ops.push(`set ${key}`)

        if (sets.delete(key)) {
          throw new Error(`the storage is full: ${value}`)
        }

        memory.set(key, value)
      },
      remove: (key) => {
        ops.push(`remove ${key}`)

        if (removes.delete(key)) {
          throw new Error(`the storage would not let ${key} go`)
        }

        memory.remove(key)
      },
    },
  }
}

/** Of `ops`, the writes of the device's token and of the tokens left to sign out, in order. */
const tokenOps = (ops: readonly string[]) =>
  ops.filter((op) => op.endsWith('.token') || op.endsWith('.pending-revoke'))

/** The sign-in's answer once it threw or its cleanup did: it names nothing of the throw. */
const broken = { code: 'data:AUTH_FAILED', message: 'the sign-in could not be completed' }

/** What the browser's storage would not keep reports, naming no token. */
const unkept = {
  code: 'data:WRITE_FAILED',
  message: 'a token could not be kept for revocation on this browser',
}

/**
 * The identity databases of a browser whose first open fails, `onFail` running as it does; the
 * opens after it work.
 */
function failingFirstOpen(onFail: () => void = () => {}): BrowserDatabases {
  const databases = browserDatabases()
  let failed = false

  return {
    open: (identity) => {
      if (failed) {
        return databases.open(identity)
      }

      failed = true
      onFail()

      return errAsync(dataError('data:OPEN_FAILED', `the browser would not open ${identity}`))
    },
  }
}

describe('a sign-in whose memberships cannot be read', () => {
  it.each(failedReads)(
    "%s: fails with the read's own error, keeps nobody signed in and has the new token signed out",
    async (_, answer, code) => {
      const storage = memoryStorage()
      const auth = fakeGatewayAuth()

      expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
      auth.requests.splice(0)
      // The sign-out cannot reach the gateway either: the token waits in the queue.
      auth.answerSignOut(() => errAsync(unreachable()))

      const { fetcher, sent } = fakeFetch(answer)
      const tab = await world({ storage, auth, listMemberships: readThrough(fetcher) })
      const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()
      const device = deviceIdFrom(storage)

      expect(failed.code).toBe(code)
      // The read went out with the token the sign-in was given, before anything was saved.
      expect(sent.map(({ authorization, device: named }) => [authorization, named])).toEqual([
        [`Bearer ${ISSUED}`, device],
      ])
      expectNobodySaved(storage)
      expect(tab.session.current()).toBeUndefined()
      expect(tab.opened()).toEqual([])
      // Online, the token is sent to be signed out at once; out of reach, it is queued once the
      // gateway answered.
      await vi.waitFor(() =>
        expect(auth.requests.filter(({ kind }) => kind === 'sign-out')).toEqual([
          { kind: 'sign-out', token: ISSUED, device },
        ]),
      )
      await vi.waitFor(() => expect(pendingRevokes(storage)).toEqual([{ token: ISSUED, device }]))
      // Nothing told names the token.
      expect(failed.message).not.toContain(ISSUED)
      expect(JSON.stringify(tab.failures)).not.toContain(ISSUED)
    },
  )

  it('forgets the token once the gateway signed it out', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    const { fetcher } = fakeFetch(respond(500, { code: 'internal' }))
    const tab = await world({ storage, auth, listMemberships: readThrough(fetcher) })

    expect((await tab.session.signIn(annSignUp))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    await vi.waitFor(() => expect(pendingRevokes(storage)).toEqual([]))
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in', 'sign-out'])
    expectNobodySaved(storage)
    expect(tab.failures).toEqual([])
  })

  it('keeps the token queued, reporting it without the token, when the gateway fails its sign-out', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()
    const failure = dataError('data:WRITE_FAILED', 'the gateway could not sign the token out (500)')

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.answerSignOut(() => errAsync(failure))

    const { fetcher } = fakeFetch(respond(401, { code: 'unauthorized' }))
    const tab = await world({ storage, auth, listMemberships: readThrough(fetcher) })

    expect((await tab.session.signIn(annSignUp)).isErr()).toBe(true)
    await vi.waitFor(() => expect(tab.failures.splice(0)).toEqual([failure]))
    expect(pendingRevokes(storage)).toEqual([{ token: ISSUED, device: deviceIdFrom(storage) }])
    expect(JSON.stringify(failure)).not.toContain(ISSUED)
  })

  it('keeps the token queued without sending it while the browser has no network', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const tab = await world({
      storage,
      auth,
      online: false,
      listMemberships: readThrough(fetcher),
    })

    // Ann's account, verified on another device: it was given the first token.
    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    expect((await tab.session.signIn(annSignUp))._unsafeUnwrapErr().code).toBe('data:OFFLINE')
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in'])
    expect(pendingRevokes(storage)).toEqual([{ token: 'token-2', device: deviceIdFrom(storage) }])
    expectNobodySaved(storage)
  })

  it('saves the memberships it read, then opens the space with them', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)

    const { fetcher, sent } = fakeFetch(respond(200, { memberships: [acme] }))
    const tab = await world({
      storage,
      auth,
      online: false,
      listMemberships: readThrough(fetcher),
    })
    const user = (await tab.session.signIn(annSignUp))._unsafeUnwrap()

    expect(sent).toHaveLength(1)
    expect(savedToken(storage)).toBe(ISSUED)
    expect(savedMemberships(storage, user.id)).toEqual([acme])
    expect(tab.session.memberships()).toEqual([acme])
    expect(pendingRevokes(storage)).toEqual([])
  })
})

describe('a sign-in whose space does not open', () => {
  it("fails with the open's error, keeps nobody signed in and has the new token signed out", async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()
    // Ann's account, verified on another device: it was given the first token.
    const made = (await verifiedElsewhere(auth, annSignUp))._unsafeUnwrap()

    auth.requests.splice(0)
    auth.answerSignOut(() => errAsync(unreachable()))

    const tab = await world({ storage, auth, refusedIdentities: [made.id] })
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()
    const device = deviceIdFrom(storage)

    expect(failed.code).toBe('data:OPEN_FAILED')
    expectNobodySaved(storage)
    expect(tab.session.current()).toBeUndefined()
    await vi.waitFor(() =>
      expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in', 'sign-out']),
    )
    await vi.waitFor(() => expect(pendingRevokes(storage)).toEqual([{ token: 'token-2', device }]))
    expect(JSON.stringify(tab.failures)).not.toContain('token-2')
  })

  it('a cleanup that throws after removing the token: the token went to be signed out first, and the sign-in fails naming nothing', async () => {
    // Of the cleanup, the token's removal lands and the identity's throws.
    const { storage, ops } = brokenStorage({ remove: ['perch.session.identity'] })
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    unreachableSignOuts(auth)

    const tab = await world({ storage, auth, online: false, databases: failingFirstOpen() })
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(failed).toEqual(broken)
    expect(JSON.stringify(tab.failures)).not.toContain('token-2')
    // The token was left to sign out before the cleanup touched the storage: the cleanup's throw
    // could not keep it from the queue.
    expect(tokenOps(ops)).toEqual([
      'set perch.session.token',
      'set perch.session.pending-revoke',
      'remove perch.session.token',
    ])
    expect(pendingRevokes(storage)).toEqual([{ token: 'token-2', device: deviceIdFrom(storage) }])
    expect(savedToken(storage)).toBeUndefined()
    expect(tab.session.current()).toBeUndefined()
    // The next sign-in takes the lock and signs in.
    expect((await tab.session.signIn(annSignUp))._unsafeUnwrap().email).toBe(annSignUp.email)
  })

  it('a hand-off that throws: the device is forgotten all the same, and the sign-in fails naming nothing', async () => {
    const memory = memoryStorage()
    // Once the space failed to open, the first read of the device's id throws, its text naming
    // the token: the hand-off of the token throws.
    let armed = false
    let thrown = false
    const storage: MemoryStorage = {
      ...memory,
      get: (key) => {
        if (armed && !thrown && key === 'perch.device.id') {
          thrown = true
          throw new Error(`the storage broke beside ${memory.get('perch.session.token')}`)
        }

        return memory.get(key)
      },
    }
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    unreachableSignOuts(auth)

    const databases = failingFirstOpen(() => {
      armed = true
    })
    const tab = await world({ storage, auth, online: false, databases })
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(thrown).toBe(true)
    expect(failed).toEqual(broken)
    expect(JSON.stringify(tab.failures)).not.toContain('token-2')
    // The cleanup ran all the same: nobody is signed in.
    expectNobodySaved(storage)
    expect(tab.session.current()).toBeUndefined()
    // The next sign-in takes the lock and signs in.
    expect((await tab.session.signIn(annSignUp))._unsafeUnwrap().email).toBe(annSignUp.email)
  })

  it('an open that throws once the space opened: keeps the device with the token its space uses, and signs nothing out', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)

    const tab = await world({ storage, auth, online: false })

    // A subscriber breaks as it hears the identity, its text naming the token.
    tab.session.subscribe((user) => {
      if (user) {
        throw new Error(`a subscriber broke beside ${ISSUED}`)
      }
    })

    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    // The identity's lock turns the throw into the open's own failure.
    expect(failed.code).toBe('data:OPEN_FAILED')
    expect(failed.message).not.toContain(ISSUED)
    expect(JSON.stringify(tab.failures)).not.toContain(ISSUED)
    // The space opened before the throw: nothing of it is undone, its token is not signed out.
    expect(tab.session.current()?.email).toBe(annSignUp.email)
    expect(savedToken(storage)).toBe(ISSUED)
    expect(pendingRevokes(storage)).toEqual([])
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in'])
  })

  it.each([
    ['fails', 'data:OPEN_FAILED'],
    ['opens', 'data:AUTH_FAILED'],
  ] as const)(
    'a space that %s only after the session closed: the saved device stays whole and nothing is signed out',
    async (outcome, code) => {
      const storage = memoryStorage()
      const auth = fakeGatewayAuth()
      const made = (await verifiedElsewhere(auth, annSignUp))._unsafeUnwrap()

      auth.requests.splice(0)

      const databases = browserDatabases()
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let asked = false
      const tab = await world({
        storage,
        auth,
        databases: {
          open: (identity) => {
            asked = true

            return new ResultAsync(
              held.then(() =>
                outcome === 'fails'
                  ? err(dataError('data:OPEN_FAILED', `the browser would not open ${identity}`))
                  : databases.open(identity),
              ),
            )
          },
        },
      })
      const signingIn = tab.session.signIn(annSignUp)

      await vi.waitFor(() => expect(asked).toBe(true))
      await tab.session.close()
      release()

      expect((await signingIn)._unsafeUnwrapErr().code).toBe(code)
      expect(savedToken(storage)).toBe('token-2')
      expect(savedIdentity(storage)?.id).toBe(made.id)
      expect(pendingRevokes(storage)).toEqual([])
      expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in'])
    },
  )
})

describe('a sign-in that throws while it holds its token', () => {
  /** A memberships read that throws once, its text carrying the token, then answers none. */
  function brokenOnce(broken: () => ResultAsync<readonly Membership[], DataError>) {
    let calls = 0

    return () => {
      calls += 1

      return calls === 1 ? broken() : okAsync<readonly Membership[]>([])
    }
  }

  /** The sign-in fails as broken, naming no token, and the next one, holding the lock again, works. */
  async function expectBrokenThenNext(tab: TestWorld, storage: MemoryStorage, token: string) {
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(failed).toEqual({
      code: 'data:AUTH_FAILED',
      message: 'the sign-in could not be completed',
    })
    expect(JSON.stringify(failed)).not.toContain(token)
    expect(JSON.stringify(tab.failures)).not.toContain(token)
    expect(tab.session.current()).toBeUndefined()
    expect(pendingRevokes(storage)).toEqual([{ token, device: deviceIdFrom(storage) }])

    // The lock was let go: the next sign-in is not held back.
    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
    expect(savedToken(storage)).not.toBe(token)
  }

  it.each([
    [
      'a read that throws',
      () => {
        throw new Error(`the read broke with ${ISSUED}`)
      },
    ],
    [
      'a read whose promise rejects',
      () =>
        new ResultAsync<readonly Membership[], DataError>(
          Promise.reject(new Error(`the read broke with ${ISSUED}`)),
        ),
    ],
  ] as const)('%s: keeps nobody signed in and has the token signed out', async (_, broken) => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    unreachableSignOuts(auth)

    const tab = await world({ storage, auth, online: false, listMemberships: brokenOnce(broken) })

    await expectBrokenThenNext(tab, storage, 'token-2')
  })

  it('a save that throws midway: undoes what it saved and has the token signed out', async () => {
    // The memberships and the token land, then the identity's write throws.
    const { storage } = brokenStorage({ set: ['perch.session.identity'] })
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    unreachableSignOuts(auth)

    const tab = await world({ storage, auth, online: false })
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expectNobodySaved(storage)
    expect(storage.get('perch.session.memberships')).toBeUndefined()
    expect(pendingRevokes(storage)).toEqual([{ token: 'token-2', device: deviceIdFrom(storage) }])
    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
  })

  it("a save that throws before its token landed: leaves another tab's token of the account alone", async () => {
    const { storage } = brokenStorage({ set: ['perch.session.token'] })
    const auth = fakeGatewayAuth()
    const made = (await verifiedElsewhere(auth, annSignUp))._unsafeUnwrap()

    auth.requests.splice(0)
    unreachableSignOuts(auth)
    // Another tab keeps Ann signed in with a token of its own.
    storage.changeElsewhere('perch.session.token', 'token-of-the-other-tab')
    storage.changeElsewhere(
      'perch.session.identity',
      JSON.stringify({ id: made.id, email: made.email }),
    )

    const tab = await world({ storage, auth, online: false })

    expect((await tab.session.signIn(annSignUp))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(savedToken(storage)).toBe('token-of-the-other-tab')
    expect(savedIdentity(storage)?.id).toBe(made.id)
    expect(pendingRevokes(storage)).toEqual([{ token: 'token-2', device: deviceIdFrom(storage) }])
  })

  it('a save that throws midway, then a cleanup that throws after removing the token: the token went to the queue first', async () => {
    // The memberships and the token land, then the identity's write throws; of the cleanup, the
    // token's removal lands and the identity's throws.
    const { storage, ops } = brokenStorage({
      set: ['perch.session.identity'],
      remove: ['perch.session.identity'],
    })
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    unreachableSignOuts(auth)

    const tab = await world({ storage, auth, online: false })
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(failed).toEqual({
      code: 'data:AUTH_FAILED',
      message: 'the sign-in could not be completed',
    })
    expect(JSON.stringify(tab.failures)).not.toContain('token-2')
    // The token was left to sign out before the cleanup touched the storage: the cleanup's throw
    // could not keep it from the queue.
    expect(tokenOps(ops)).toEqual([
      'set perch.session.token',
      'set perch.session.pending-revoke',
      'remove perch.session.token',
    ])
    expect(pendingRevokes(storage)).toEqual([{ token: 'token-2', device: deviceIdFrom(storage) }])
    expectNobodySaved(storage)
    // The lock was let go: the next sign-in is not held back.
    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
  })

  it('a save that throws midway, then a queue that throws taking the token: the token is held in memory and the partial save undone all the same', async () => {
    // The identity's write throws, then so does the queue's: the token is held in memory for the
    // page's lifetime, which is reported, and the cleanup runs to its end.
    const { storage, ops } = brokenStorage({
      set: ['perch.session.identity', 'perch.session.pending-revoke'],
    })
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    unreachableSignOuts(auth)

    const tab = await world({ storage, auth, online: false })
    const failed = (await tab.session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(failed).toEqual({
      code: 'data:AUTH_FAILED',
      message: 'the sign-in could not be completed',
    })
    expect(JSON.stringify(tab.failures)).not.toContain('token-2')
    // The queue was asked first, and its throw did not stop the cleanup.
    expect(tokenOps(ops)).toEqual([
      'set perch.session.token',
      'set perch.session.pending-revoke',
      'remove perch.session.token',
    ])
    expectNobodySaved(storage)
    expect(storage.get('perch.session.memberships')).toBeUndefined()
    expect(pendingRevokes(storage)).toEqual([])
    expect(tab.failures).toContainEqual(unkept)
    // The lock was let go: the next sign-in is not held back, and sends the held token first.
    expect((await tab.session.signIn(annSignUp)).isOk()).toBe(true)
    expect(auth.requests.map(({ kind }) => kind)).toEqual(['sign-in', 'sign-out', 'sign-in'])
    expect(auth.requests[1]).toEqual({
      kind: 'sign-out',
      token: 'token-2',
      device: deviceIdFrom(storage),
    })
  })
})

/** The gateway's sign-outs cannot reach it: a token left to sign out stays queued. */
function unreachableSignOuts(auth: ReturnType<typeof fakeGatewayAuth>): void {
  auth.answerSignOut(() => errAsync(unreachable()))
}
