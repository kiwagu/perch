import { ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory, profileIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { createProfile, profileById } from '../__fixtures__/profile'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { signedIn, signedInElsewhere, signedOutElsewhere } from '../__fixtures__/signed-in'
import {
  type MemoryStorage,
  memoryStorage,
  savedIdentity,
  savedSession,
  savedToken,
} from '../storage'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const bob = {
  identity: { id: identityIdFactory.create(), email: 'bob@example.test' },
  token: 'token-bob',
  memberships: [],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

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

/** A browser that keeps Ann signed in from an earlier sign-in. */
function annSaved(): MemoryStorage {
  const storage = memoryStorage()

  signedIn(storage, ann)

  return storage
}

/** A tab of a browser that keeps Ann, offline, whose database opens once the test lets it. */
async function annOpeningHeld() {
  const held = deferred()
  const shared = browserDatabases()
  const storage = annSaved()
  const tab = await world({
    storage,
    online: false,
    databases: {
      open: (identity) =>
        ResultAsync.fromSafePromise(held.promise).andThen(() => shared.open(identity)),
    },
  })

  return { ...tab, storage, open: held.resolve }
}

describe("the start's open of the saved identity's space", () => {
  it('names the saved identity while the space opens, and reads and writes wait for it', async () => {
    const held = deferred()
    const shared = browserDatabases()
    const { session } = await world({
      storage: annSaved(),
      online: false,
      // The identity's database opens only once the test lets it.
      databases: {
        open: (identity) =>
          ResultAsync.fromSafePromise(held.promise).andThen(() => shared.open(identity)),
      },
    })
    const restoring = session.restore()
    const id = profileIdFactory.create()
    const errors: DataError[] = []
    const watched: unknown[] = []

    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.space()).toBeUndefined()

    const written = session.writePath.run(createProfile, {
      id,
      identity: ann.identity.id,
      name: 'Ann',
      email: ann.identity.email,
    })
    const read = session.runner.read(profileById, { id })
    const stop = session.runner.watch(profileById, { id }, (tree) => watched.push(tree), {
      onError: (error) => errors.push(error),
    })

    held.resolve()

    expect((await restoring).isOk()).toBe(true)
    expect((await written).isOk()).toBe(true)
    expect((await read).isOk()).toBe(true)
    expect((await session.flush()).isOk()).toBe(true)
    await vi.waitFor(() => expect(watched.at(-1)).toMatchObject({ name: 'Ann' }))
    expect(errors).toEqual([])
    expect(session.current()?.id).toBe(ann.identity.id)
    stop()
  })

  it('keeps the saved identity current when its space does not open, and what waited for it refuses', async () => {
    const { session } = await world({
      storage: annSaved(),
      online: false,
      refusedIdentities: [ann.identity.id],
    })
    const restoring = session.restore()

    expect(session.current()?.id).toBe(ann.identity.id)

    const read = session.runner.read(profileById, { id: profileIdFactory.create() })

    expect((await restoring)._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect((await read)._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    // The account is still signed in on this device: its frame says its data did not open.
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.space()).toBeUndefined()
  })

  it('adopts an organisation created while the space opens, once it is open', async () => {
    const { session, open } = await annOpeningHeld()
    const restoring = session.restore()
    // The adopter is taken before the request, while the space opens; the answer comes before it is open.
    const adopt = session.membershipAdopter()
    const adopted = adopt(acme)

    open()

    expect((await restoring).isOk()).toBe(true)
    await adopted
    expect(session.memberships().map(({ tenant }) => tenant.key)).toEqual(['acme'])
  })

  it('signs this device out everywhere when asked while the space opens, once it is open, with no channel', async () => {
    const { session, storage, open } = await annOpeningHeld()
    const restoring = session.restore()
    const signOutHere = session.signingOutEverywhere()

    open()

    expect((await restoring).isOk()).toBe(true)
    expect((await signOutHere()).isOk()).toBe(true)
    expect(session.current()).toBeUndefined()
    expect(savedIdentity(storage)).toBeUndefined()
    expect(session.notice()).toBe('signed-out-elsewhere')
  })

  it('names nobody while it opens when nobody is saved', async () => {
    const { session } = await world({ online: false })
    const restoring = session.restore()

    expect(session.current()).toBeUndefined()
    expect((await restoring).isOk()).toBe(true)
    expect(
      (await session.runner.read(profileById, { id: profileIdFactory.create() }))._unsafeUnwrapErr()
        .code,
    ).toBe('data:QUERY_FAILED')
  })
})

describe('another tab signing out the account whose space this tab has not opened', () => {
  it('leaves at once while the space opens: the open attaches nothing, and the start ends with nobody signed in', async () => {
    const { session, storage, open } = await annOpeningHeld()
    const told: Array<string | undefined> = []

    session.subscribe((user) => told.push(user?.id))

    const restoring = session.restore()

    signedOutElsewhere(storage)

    // At once, not behind the open: nothing more is asked in the account's name.
    expect(session.current()).toBeUndefined()
    expect(told).toEqual([undefined])

    open()

    expect((await restoring)._unsafeUnwrap()).toBeUndefined()
    expect(session.space()).toBeUndefined()
    expect(session.current()).toBeUndefined()
    expect(told).toEqual([undefined])
  })

  it('follows the account another tab signs in next, once the open it left has ended', async () => {
    const { session, storage, open } = await annOpeningHeld()
    const restoring = session.restore()

    signedOutElsewhere(storage)
    signedInElsewhere(storage, bob)

    expect(session.current()).toBeUndefined()

    open()

    expect((await restoring).isOk()).toBe(true)
    await vi.waitFor(() => expect(session.space()?.identity.id).toBe(bob.identity.id))
    expect(session.current()?.id).toBe(bob.identity.id)
  })

  it('leaves at once once the space did not open', async () => {
    const storage = annSaved()
    const { session } = await world({
      storage,
      online: false,
      refusedIdentities: [ann.identity.id],
    })
    const told: Array<string | undefined> = []

    session.subscribe((user) => told.push(user?.id))

    expect((await session.restore()).isErr()).toBe(true)
    expect(session.current()?.id).toBe(ann.identity.id)

    signedOutElsewhere(storage)

    expect(session.current()).toBeUndefined()
    expect(told).toEqual([undefined])
  })

  it('signs out on this device only the account whose space did not open, never one saved since', async () => {
    const storage = annSaved()
    const annSession = savedSession(storage) ?? expect.unreachable('Ann saved')
    const tab = await world({
      storage,
      online: false,
      refusedIdentities: [ann.identity.id],
    })

    expect((await tab.session.restore()).isErr()).toBe(true)

    // Another tab signed Ann out and Bob in; this tab has not heard of it yet.
    signedIn(storage, bob)

    expect((await tab.session.signOutUnopened(annSession)).isOk()).toBe(true)
    expect(savedIdentity(storage)?.id).toBe(bob.identity.id)
    expect(savedToken(storage)).toBe(bob.token)
    expect(tab.localsDeleted()).toEqual([])
  })
})
