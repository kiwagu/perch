import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory, profileIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { writeLockName } from '@workspace/replica/sync'
import { type FakeHintChannel, FakeLocks } from '@workspace/replica/testing'

import { createProfile } from '../__fixtures__/profile'
import { browserDatabases, openTestWorld, type TestWorld } from '../__fixtures__/session'
import { signedIn, signedInElsewhere, signedOut } from '../__fixtures__/signed-in'
import {
  type KeptDevice,
  markSignIn,
  memoryStorage,
  savedIdentity,
  savedNotice,
  savedToken,
} from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

/** Ann again, signed in by another tab of the browser with a new session. */
const annAgain: KeptDevice = { ...ann, token: 'token-ann-again' }

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

/** Ann's tab, signed in and syncing on `locks`, which the browser's other tabs share: it leads. */
async function annSyncing(locks: FakeLocks): Promise<TestWorld> {
  const storage = memoryStorage()

  signedIn(storage, ann)

  const booted = await openTestWorld({ storage, locks, online: true })

  worlds.push(booted)
  expect((await booted.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

  return booted
}

/** Holds Ann's write lock exclusively, as another tab's sign-out does; the returned function lets go. */
function holdWriteLock(locks: FakeLocks): () => void {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })

  void locks.request(writeLockName(ann.identity.id), { mode: 'exclusive' }, () => held)

  return release
}

/**
 * Closes the channel of Ann's tab with `code` while another tab's sign-out holds her write lock,
 * and has that tab save `device` before this tab's sign-out gets the lock, or before it gives up
 * waiting for it when `lockComes` is false. `channels` counts the channels the tab opened before.
 */
async function overtaken(code: number, device: KeptDevice, lockComes = true) {
  const locks = new FakeLocks()
  const world = await annSyncing(locks)
  const channels = world.contexts().length
  const id = world.storage.get('perch.device.id') ?? expect.unreachable('a device id')
  const lock = writeLockName(ann.identity.id)
  const letGo = holdWriteLock(locks)

  world.stub.closeChannels(ann.identity.id, id, code)
  await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(true))
  signedInElsewhere(world.storage, device)

  if (lockComes) {
    letGo()
  } else {
    // A frozen tab never lets go: the sign-out gives up waiting.
    await world.clock.advance(10_000)
  }

  await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(false))

  return { world, channels }
}

describe('a forced sign-out and a sign-in another tab made meanwhile', () => {
  it.each([
    ['another device signed it out (4001)', CLOSE.revoked],
    ['the password changed (4002)', CLOSE.passwordChanged],
  ])(
    'keeps the same account, signed in again while the sign-out waited for the write lock, and syncs with its token: %s',
    async (_why, code) => {
      const { world, channels } = await overtaken(code, annAgain)
      const { session, storage, destroyed, contexts, states } = world

      // The tab follows that sign-in, as on any sign-in made in another tab: a new channel.
      await vi.waitFor(() => expect(session.current()?.id).toBe(ann.identity.id))
      await vi.waitFor(() => expect(contexts().length).toBeGreaterThan(channels))
      await vi.waitFor(() => expect(states.at(-1)).toEqual({ leader: true, channel: 'up' }))
      expect(contexts().at(-1)?.credentials()).toEqual({ token: annAgain.token })
      expect(savedToken(storage)).toBe(annAgain.token)
      expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
      expect(destroyed()).toEqual([])
      expect(session.notice()).toBeUndefined()
    },
  )

  it('keeps the same account signed in again when the sign-out gave up waiting for the lock', async () => {
    const { world } = await overtaken(CLOSE.revoked, annAgain, false)
    const { session, storage, destroyed } = world

    await vi.waitFor(() => expect(session.current()?.id).toBe(ann.identity.id))
    expect(savedToken(storage)).toBe(annAgain.token)
    expect(destroyed()).toEqual([])
    // Nothing was kept for a next sign-in: the sign-in made since goes on with the data.
    expect(session.notice()).toBeUndefined()
  })

  it('lets a tab that stays open write at once: the barrier is lifted before this tab leaves', async () => {
    const locks = new FakeLocks()
    const storage = memoryStorage()
    const shared = {
      storage,
      locks,
      databases: browserDatabases(),
      hints: new Set<FakeHintChannel>(),
      online: true,
    }

    signedIn(storage, ann)

    const a = await openTestWorld(shared)

    worlds.push(a)
    expect((await a.session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(a.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    const b = await openTestWorld({ ...shared, gateway: a.gateway })

    worlds.push(b)
    expect((await b.session.restore()).isOk()).toBe(true)

    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')
    const lock = writeLockName(ann.identity.id)
    const letGo = holdWriteLock(locks)

    // Tab a's channel closes; while its sign-out waits, a third tab signs Ann in again.
    a.stub.closeChannels(ann.identity.id, id, CLOSE.revoked)
    await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(true))
    signedInElsewhere(storage, annAgain)
    letGo()
    // Tab a's sign-out ended (it left its space at once), and the tab follows that sign-in.
    await vi.waitFor(() => expect(storage.get('perch.session.signing-out')).toBeUndefined())
    await vi.waitFor(() => expect(a.session.current()?.id).toBe(ann.identity.id))

    // Tab b stayed open throughout, and heard the sign-out begin: it hears it end too.
    const profile = {
      id: profileIdFactory.create(),
      identity: ann.identity.id,
      name: 'Ann',
      email: ann.identity.email,
    }

    const written = await b.session.writePath.run(createProfile, profile)

    expect(written.isErr() ? written.error : undefined).toBeUndefined()
  })

  it('keeps another account a tab signed in while the sign-out waited, and follows it', async () => {
    const { session, storage, destroyed } = (await overtaken(CLOSE.revoked, bob)).world

    await vi.waitFor(() => expect(session.current()?.id).toBe(bob.identity.id))
    expect(savedToken(storage)).toBe(bob.token)
    expect(savedIdentity(storage)?.id).toBe(bob.identity.id)
    // Ann's data is the call of the tab that signed her out.
    expect(destroyed()).toEqual([])
    expect(session.notice()).toBeUndefined()
  })

  it('leaves the sign-in page no word once an account signed in and out while it waited', async () => {
    const locks = new FakeLocks()
    const world = await annSyncing(locks)
    const { session, storage, destroyed } = world
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')
    const lock = writeLockName(ann.identity.id)
    const letGo = holdWriteLock(locks)

    world.stub.closeChannels(ann.identity.id, id, CLOSE.revoked)
    await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(true))
    // Another tab ends the same session first, then Bob signs in there and out again; this tab
    // hears of it only once its own sign-out goes on.
    signedOut(storage)
    markSignIn(storage)
    letGo()

    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(savedNotice(storage)).toBeUndefined()
    expect(session.notice()).toBeUndefined()
  })
})
