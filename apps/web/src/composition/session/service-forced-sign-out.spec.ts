import { afterEach, describe, expect, it, vi } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { writeLockName } from '@workspace/replica/sync'
import { FakeLocks } from '@workspace/replica/testing'

import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import {
  IDENTITY_KEY,
  type KeptDevice,
  MEMBERSHIPS_KEY,
  type MemoryStorage,
  memoryStorage,
  saveDevice,
  savedIdentity,
  savedToken,
  TOKEN_KEY,
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

  saveDevice(storage, ann)

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

/** Saves `device` as another tab's sign-in does, in its order, each key heard as changed there. */
function signedInElsewhere(storage: MemoryStorage, device: KeptDevice): void {
  const theirs = memoryStorage()

  saveDevice(theirs, device)

  for (const key of [MEMBERSHIPS_KEY, TOKEN_KEY, IDENTITY_KEY]) {
    storage.changeElsewhere(key, theirs.get(key))
  }
}

/**
 * Closes the channel of Ann's tab with `code` while another tab's sign-out holds her write lock,
 * and has that tab save `device` before this tab's sign-out gets the lock.
 */
async function overtaken(code: number, device: KeptDevice): Promise<TestWorld> {
  const locks = new FakeLocks()
  const world = await annSyncing(locks)
  const id = world.storage.get('perch.device.id') ?? expect.unreachable('a device id')
  const lock = writeLockName(ann.identity.id)
  const letGo = holdWriteLock(locks)

  world.stub.closeChannels(ann.identity.id, id, code)
  await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(true))
  signedInElsewhere(world.storage, device)
  letGo()
  await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(false))

  return world
}

describe('a forced sign-out and a sign-in another tab made meanwhile', () => {
  it.each([
    ['another device signed it out (4001)', CLOSE.revoked],
    ['the password changed (4002)', CLOSE.passwordChanged],
  ])(
    'keeps the same account, signed in again while the sign-out waited for the write lock, and syncs with its token: %s',
    async (_why, code) => {
      const { session, storage, destroyed, contexts } = await overtaken(code, annAgain)

      // The tab follows that sign-in, as on any sign-in made in another tab.
      await vi.waitFor(() => expect(session.current()?.id).toBe(ann.identity.id))
      await vi.waitFor(() =>
        expect(contexts().at(-1)?.credentials()).toEqual({ token: annAgain.token }),
      )
      expect(savedToken(storage)).toBe(annAgain.token)
      expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
      expect(destroyed()).toEqual([])
      expect(session.notice()).toBeUndefined()
    },
  )

  it('keeps another account a tab signed in while the sign-out waited, and follows it', async () => {
    const { session, storage, destroyed } = await overtaken(CLOSE.revoked, bob)

    await vi.waitFor(() => expect(session.current()?.id).toBe(bob.identity.id))
    expect(savedToken(storage)).toBe(bob.token)
    expect(savedIdentity(storage)?.id).toBe(bob.identity.id)
    // Ann's data is the call of the tab that signed her out.
    expect(destroyed()).toEqual([])
    expect(session.notice()).toBeUndefined()
  })
})
