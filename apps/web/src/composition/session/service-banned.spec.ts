import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { identityIdFactory, profileIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { writeLockName } from '@workspace/replica/sync'
import { FakeLocks } from '@workspace/replica/testing'

import { createProfile } from '../__fixtures__/profile'
import { openTestWorld, type TestWorld } from '../__fixtures__/session'
import { signedIn } from '../__fixtures__/signed-in'
import {
  type KeptDevice,
  memoryStorage,
  rolesKeyOf,
  savedIdentity,
  savedNotice,
  savedSession,
} from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const worlds: TestWorld[] = []

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

/** Ann's device, signed in and syncing: this tab leads, its channel is up. */
async function annSyncing(locks = new FakeLocks()): Promise<TestWorld> {
  const storage = memoryStorage()

  signedIn(storage, ann)

  const booted = await openTestWorld({ storage, locks, online: true })

  worlds.push(booted)
  expect((await booted.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

  return booted
}

/**
 * Ann's device, signed in and offline, holding a change it has not sent: the write is real and
 * durable, and the outbox reads it before anything ends the session.
 */
async function annHoldingUnsent(): Promise<TestWorld> {
  const storage = memoryStorage()

  signedIn(storage, ann)

  const booted = await openTestWorld({ storage, online: false })

  worlds.push(booted)
  expect((await booted.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

  const written = await booted.session.writePath.run(createProfile, {
    id: profileIdFactory.create(),
    identity: ann.identity.id,
    name: 'Ann',
    email: ann.identity.email,
  })

  expect(written.isOk()).toBe(true)

  const space = booted.session.space() ?? expect.unreachable('a space')

  expect((await space.unsent())._unsafeUnwrap()).toBe(true)

  return booted
}

/** Closes the channel of this device (the one `world` signed in) with `code`, as the gateway does. */
function closeOwnChannel({ stub, storage }: TestWorld, code: number): void {
  const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

  stub.closeChannels(ann.identity.id, id, code)
}

describe("an operator's ban of the account", () => {
  it('signs the device out when its channel closes with 4004, its data gone, and the sign-in page says why', async () => {
    const { session, stub, storage, destroyed } = await annSyncing()
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    stub.closeChannels(ann.identity.id, id, CLOSE.banned)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('account-banned')
    // The ban ended the session on the gateway: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it("takes the account's platform roles off the device with the session", async () => {
    const { session, stub, storage, contexts } = await annSyncing()
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')
    const kept = savedSession(storage) ?? expect.unreachable('a saved session')
    const heard: Array<readonly string[]> = []

    // A welcome had carried the operator's role.
    contexts().at(-1)?.onRoles(['operator'])
    expect([...session.roles()]).toEqual(['operator'])
    session.onRoles((roles) => heard.push([...roles]))

    stub.closeChannels(ann.identity.id, id, CLOSE.banned)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(storage.get(rolesKeyOf(kept.signIn))).toBeUndefined()
    expect(session.roles().size).toBe(0)
    expect(heard.at(-1)).toEqual([])
  })

  it('keeps a device signed in while a ban closes the channel of another one', async () => {
    const { session, stub } = await annSyncing()

    stub.closeChannels(ann.identity.id, 'another-device', CLOSE.banned)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(session.notice()).toBeUndefined()
  })
})

describe("an operator's ban of the account, on a device that holds changes it has not sent", () => {
  it('keeps the database and the changes, and the sign-in page still says the account was banned', async () => {
    const world = await annHoldingUnsent()
    const { session, storage, destroyed, localsDeleted } = world

    closeOwnChannel(world, CLOSE.banned)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    // The changes wait for a next sign-in as Ann: nothing deleted the database.
    await settle()
    expect(destroyed()).toEqual([])
    expect(localsDeleted()).toEqual([])
    // The word of the ban ranks above the one that says the changes stay: the page says it.
    expect(savedNotice(storage)).toBe('account-banned')
    expect(session.notice()).toBe('account-banned')
    // The ban ended the session on the gateway: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()

    // The page said it once: it takes the words away, the one that ranks below included.
    session.clearNotice()

    expect(session.notice()).toBeUndefined()
  })

  it('keeps the database, and says the account was banned, when the outbox cannot be read', async () => {
    const { session, stub, storage, destroyed, failures } = await annSyncing()
    const space = session.space() ?? expect.unreachable('a space')
    const unreadable = dataError('data:QUERY_FAILED', 'could not read the outbox')
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    vi.spyOn(space, 'unsent').mockReturnValue(errAsync(unreadable))
    stub.closeChannels(ann.identity.id, id, CLOSE.banned)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await settle()
    expect(destroyed()).toEqual([])
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('account-banned')
    expect(failures.splice(0)).toEqual([unreadable])
  })

  it('keeps the database, and says the account was banned, when another tab never lets its write go', async () => {
    const locks = new FakeLocks()
    const world = await annSyncing(locks)
    const { session, storage, destroyed, clock } = world
    const lock = writeLockName(ann.identity.id)

    // A frozen tab holds a write it never finishes: the sign-out gives up waiting for the lock.
    void locks.request(lock, { mode: 'exclusive' }, () => new Promise(() => {}))
    closeOwnChannel(world, CLOSE.banned)
    await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(true))
    await clock.advance(10_000)
    await vi.waitFor(() => expect(locks.waiting(lock, 'exclusive')).toBe(false))

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(destroyed()).toEqual([])
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('account-banned')
  })

  it.each([
    ['another device signed it out (4001)', CLOSE.revoked],
    ['the password changed (4002)', CLOSE.passwordChanged],
    ['a sign-in went past the limit of devices (4003)', CLOSE.deviceLimit],
  ])(
    'still says the changes wait to be sent when a lower-ranked ending signed it out: %s',
    async (_why, code) => {
      const world = await annHoldingUnsent()
      const { session, storage, destroyed } = world

      closeOwnChannel(world, code)

      await vi.waitFor(() => expect(session.current()).toBeUndefined())
      await settle()
      expect(destroyed()).toEqual([])
      expect(savedSession(storage)).toBeUndefined()
      expect(session.notice()).toBe('resend-after-sign-in')
    },
  )
})
