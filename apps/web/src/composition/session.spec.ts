import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { identityIdFactory, profileIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { writeLockName } from '@workspace/replica/sync'
import { type FakeHintChannel, FakeLocks } from '@workspace/replica/testing'

import { profileCommands } from '../features/user/presentation/pages/profile/profile.model.gen'

import { createProfile, profileById } from './__fixtures__/profile'
import {
  browserDatabases,
  openTestWorld,
  type TestWorld,
  type TestWorldOptions,
} from './__fixtures__/session'
import type { SignedInDevice } from './gateway-auth'
import { memoryStorage, saveDevice, savedMemberships, saveMemberships } from './storage'

const ann: SignedInDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-ann', refresh: 'refresh-ann' },
  memberships: [],
}

const annSignUp = { email: 'ann@example.test', password: 'pass-word-1' }

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

/** Ann's device as a sign-in left it, a member of `memberships`. */
const annIn = (memberships: readonly Membership[]): SignedInDevice => ({ ...ann, memberships })

const bobSignUp = { email: 'bob@example.test', password: 'pass-word-2' }

const worlds: TestWorld[] = []

afterEach(async () => {
  const closing = worlds.splice(0)

  await Promise.all(closing.map((world) => world.close()))

  for (const world of closing) {
    expect(world.failures).toEqual([])
  }
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function world(options: TestWorldOptions = {}): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/** Boots a session as a page load does, with `saved` kept from an earlier sign-in, and waits until its tab leads. */
async function bootSession(options: {
  readonly saved: SignedInDevice | undefined
  readonly online?: boolean
}) {
  const storage = memoryStorage()

  if (options.saved) {
    saveDevice(storage, options.saved)
  }

  const booted = await world({ storage, online: options.online ?? false })
  const { session } = booted

  expect((await session.restore()).isOk()).toBe(true)

  if (options.saved) {
    const channel = options.online ? 'up' : 'down'

    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel }))
  }

  return {
    ...booted,
    gateway: booted.stub,
    /** Creates the identity's profile, durably, on this device only. */
    writeOffline: async () => {
      const me = session.current() ?? expect.unreachable('signed in')

      expect(
        (
          await session.writePath.run(createProfile, {
            id: profileIdFactory.create(),
            identity: me.id,
            name: 'Ann',
            email: me.email,
          })
        ).isOk(),
      ).toBe(true)
    },
  }
}

/**
 * The params of a command that creates a profile in Ann's region: hers by default. The local
 * schema keeps one profile per identity, so a second write of a test names another identity.
 */
function aProfile(identity: string = ann.identity.id) {
  return {
    id: profileIdFactory.create(),
    identity,
    name: 'Ann',
    email: ann.identity.email,
  }
}

/**
 * Two tabs of one browser where Ann is signed in, sharing the Web Locks and Ann's database;
 * `a` leads. They share the storage too, unless `b` keeps its own (a tab that has not seen the
 * other's latest change yet), and the hint channel only when `hints` is set.
 */
async function twoTabs(options: {
  readonly online: boolean
  readonly hints?: boolean
  readonly ownStorageOfB?: boolean
  /** Wraps the database connection of tab `b`, e.g. to hold its writes. */
  readonly wrapB?: (local: LocalDb) => LocalDb
}) {
  const storage = memoryStorage()
  const locks = new FakeLocks()
  const shared = {
    locks,
    databases: browserDatabases(),
    online: options.online,
    ...(options.hints ? { hints: new Set<FakeHintChannel>() } : {}),
  }

  saveDevice(storage, ann)

  const a = await world({ ...shared, storage })

  expect((await a.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() =>
    expect(a.states.at(-1)).toEqual({ leader: true, channel: options.online ? 'up' : 'down' }),
  )

  const storageOfB = options.ownStorageOfB ? memoryStorage() : storage

  if (options.ownStorageOfB) {
    saveDevice(storageOfB, ann)
  }

  const b = await world({
    ...shared,
    storage: storageOfB,
    gateway: a.gateway,
    ...(options.wrapB ? { wrap: options.wrapB } : {}),
  })

  expect((await b.session.restore()).isOk()).toBe(true)
  await settle()
  expect(b.states.at(-1)).toEqual({ leader: false, channel: 'down' })

  return { a, b, storage, locks }
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

/** Region loads of every identity database held while `hold()` is in force. */
function holdingRegionLoads() {
  let gate: Promise<void> | undefined
  let open = () => {}
  const state = { waiting: 0 }
  const wrap = (local: LocalDb) =>
    interceptQueries(local, async (text) => {
      if (gate && text.includes('FROM _replica_snapshot')) {
        state.waiting++
        await gate
      }
    })

  return {
    wrap,
    state,
    hold: () => {
      gate = new Promise((resolve) => {
        open = resolve
      })
    },
    release: () => {
      gate = undefined
      open()
    },
  }
}

describe('SessionService', () => {
  it('starts signed out without opening any database', async () => {
    const { session, opened } = await bootSession({ saved: undefined })

    expect(session.current()).toBeUndefined()
    expect(opened()).toEqual([])
  })

  it('restores a saved identity offline: opens its database, no network needed', async () => {
    const { session, opened } = await bootSession({ saved: ann })

    expect(session.current()?.id).toBe(ann.identity.id)
    expect(opened()).toEqual([ann.identity.id])
  })

  it("signs up through the gateway, saves the keys and opens the new identity's database", async () => {
    const { session, storage, opened } = await bootSession({ saved: undefined })
    const user = (await session.signUp(annSignUp))._unsafeUnwrap()

    expect(storage.get('perch.session.identity')).toContain(user.id)
    expect(storage.get('perch.session.refresh')).toBeDefined()
    expect(opened()).toEqual([user.id])
    expect(session.current()).toEqual(user)
  })

  it('writes into the signed-in identity and reads it back through the session ports', async () => {
    const { session } = await bootSession({ saved: ann })
    const id = profileIdFactory.create()

    expect(
      (
        await session.writePath.run(createProfile, {
          id,
          identity: ann.identity.id,
          name: 'Ann',
          email: ann.identity.email,
        })
      ).isOk(),
    ).toBe(true)
    expect((await session.flush()).isOk()).toBe(true)
    expect((await session.runner.read(profileById, { id }))._unsafeUnwrap()).toMatchObject({
      name: 'Ann',
    })
  })

  it('refuses reads and writes while nobody is signed in', async () => {
    const { session } = await bootSession({ saved: undefined })
    const id = profileIdFactory.create()
    const written = await session.writePath.run(createProfile, {
      id,
      identity: ann.identity.id,
      name: 'X',
      email: 'x@example.test',
    })

    expect(written._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(written._unsafeUnwrapErr().message).toMatch(/sign in first/)
    expect((await session.runner.read(profileById, { id }))._unsafeUnwrapErr().code).toBe(
      'data:QUERY_FAILED',
    )
  })

  it('signs out online: drains, revokes through the gateway, deletes the local database and the keys', async () => {
    const { session, storage, destroyed, gateway, writeOffline } = await bootSession({
      saved: ann,
      online: true,
    })

    await writeOffline()

    expect((await session.signOut())._unsafeUnwrap()).toBe('signed-out')
    expect(gateway.signOuts()).toBe(1)
    expect(destroyed()).toEqual([ann.identity.id])
    expect(storage.get('perch.session.refresh')).toBeUndefined()
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(session.current()).toBeUndefined()
    expect(
      (await gateway.hub.heads([`identity:${ann.identity.id}`]))._unsafeUnwrap()[0]?.head,
    ).toBe(1)
  })

  it('asks before signing out offline with unsent changes, and forgets the device when told to', async () => {
    const { session, storage, destroyed, writeOffline, driveClock } = await bootSession({
      saved: ann,
      online: false,
    })

    await writeOffline()

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(storage.get('perch.session.refresh')).toBe(ann.tokens.refresh)
    expect(destroyed()).toEqual([])

    expect((await driveClock(session.signOut({ forgetUnsent: true })))._unsafeUnwrap()).toBe(
      'signed-out',
    )
    expect(session.current()).toBeUndefined()
    expect(storage.get('perch.session.refresh')).toBeUndefined()
    expect(destroyed()).toEqual([ann.identity.id])
  })

  it('signs out offline without asking when nothing is unsent', async () => {
    const { session, destroyed, gateway, driveClock } = await bootSession({
      saved: ann,
      online: false,
    })

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(destroyed()).toEqual([ann.identity.id])
    expect(gateway.signOuts()).toBe(0)
  })

  it('asks before signing out while a change fails to persist, though the outbox reads empty', async () => {
    let failAppend = false
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const booted = await world({
      storage,
      wrap: (local) =>
        interceptQueries(local, (text) => {
          if (failAppend && text.includes('_replica_outbox SET')) {
            throw new Error('the disk is full')
          }
        }),
    })
    const { session, stub, destroyed, failures, driveClock } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    failAppend = true

    // The command hears that its change was not made durable; the change lives on in memory.
    const written = await session.writePath.run(createProfile, aProfile())

    expect(written._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(stub.signOuts()).toBe(0)
    expect(destroyed()).toEqual([])
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })

  it('asks before signing out when the gateway never closes after the sign-out and a change landed meanwhile', async () => {
    const { session, stub, storage, destroyed, driveClock } = await bootSession({
      saved: ann,
      online: true,
    })
    const received = stub.keepOpenOnSignOut()
    const signingOut = session.signOut()

    await received

    // A write that passed the barrier just before it went up lands during the unanswered wait.
    const below = session.space() ?? expect.unreachable('a space')

    expect((await below.writePath.run(createProfile, aProfile())).isOk()).toBe(true)

    expect((await driveClock(signingOut))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(stub.signOuts()).toBe(1)
    expect(destroyed()).toEqual([])
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(storage.get('perch.session.refresh')).toBe(ann.tokens.refresh)
    expect(session.notice()).toBeUndefined()
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
  })

  it('syncs again on a new engine when a sent sign-out ended offline and the person stays signed in', async () => {
    const { session, stub, storage, states, driveClock } = await bootSession({
      saved: ann,
      online: true,
    })
    const received = stub.keepOpenOnSignOut()
    const signingOut = session.signOut()

    await received

    // A write that passed the barrier just before it went up: the sign-out has to ask.
    const below = session.space() ?? expect.unreachable('a space')
    const profile = aProfile()

    expect((await below.writePath.run(createProfile, profile)).isOk()).toBe(true)
    expect((await driveClock(signingOut))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(storage.get('perch.session.signing-out')).toBeUndefined()

    // The person stays signed in: nothing more is asked of the session. A later write goes
    // through the lifted barrier, and the gateway, answering again, takes both changes.
    const renamed = await session.writePath.run(profileCommands.updateName, {
      id: profile.id,
      name: 'Ana',
    })

    expect(renamed.isOk()).toBe(true)

    const space = session.space() ?? expect.unreachable('a space')

    await vi.waitFor(async () => expect((await space.unsent())._unsafeUnwrap()).toBe(false))
    expect(states.at(-1)).toEqual({ leader: true, channel: 'up' })
    expect(
      (await stub.hub.heads([`identity:${ann.identity.id}`]))._unsafeUnwrap()[0]?.head,
    ).toBeGreaterThan(0)
  })

  it('asks before signing out when the region stopped syncing with changes left in the outbox', async () => {
    const booted = await bootSession({ saved: ann, online: true })
    const { session, gateway, destroyed, failures, writeOffline } = booted

    gateway.rejectEverything()
    await writeOffline()
    await vi.waitFor(() =>
      expect(failures.map((failure) => failure.code)).toContain('data:SYNC_STOPPED'),
    )
    failures.splice(0)

    expect((await session.signOut())._unsafeUnwrap()).toBe('needs-confirmation')
    expect(destroyed()).toEqual([])

    // The changes the gateway refused cannot be sent: they are given up, and the device
    // leaves without a sign-out at the gateway, as when it is offline.
    expect((await session.signOut({ forgetUnsent: true }))._unsafeUnwrap()).toBe('signed-out')
    expect(gateway.signOuts()).toBe(0)
    expect(destroyed()).toEqual([ann.identity.id])
  })

  it('asks before signing out when the region stops syncing during the sign-out', async () => {
    const booted = await bootSession({ saved: ann, online: true })
    const { session, gateway, destroyed, failures, writeOffline } = booted

    gateway.rejectEverything()
    await writeOffline()

    // No wait for the stop: the sign-out drains the rejected batch itself.
    expect((await session.signOut())._unsafeUnwrap()).toBe('needs-confirmation')
    expect(gateway.signOuts()).toBe(0)
    expect(destroyed()).toEqual([])
    expect(session.current()?.id).toBe(ann.identity.id)

    expect((await session.signOut({ forgetUnsent: true }))._unsafeUnwrap()).toBe('signed-out')
    expect(destroyed()).toEqual([ann.identity.id])
    expect(failures.map((failure) => failure.code)).toContain('data:SYNC_STOPPED')
    failures.splice(0)
  })

  it('keeps the database and asks to sign in again when a write lands after the final drain', async () => {
    const { a, b } = await twoTabs({ online: true })
    const received = a.stub.keepOpenOnSignOut()
    const signingOut = a.session.signOut()

    await received

    // A write of the other tab that passed the barrier just before it went up lands now,
    // after the final drain and before the gateway closes the channel.
    const below = b.session.space() ?? expect.unreachable('a space')

    expect((await below.writePath.run(createProfile, aProfile())).isOk()).toBe(true)

    a.stub.endWith('signed-out')

    expect((await signingOut)._unsafeUnwrap()).toBe('signed-out')
    expect(a.stub.signOuts()).toBe(1)
    expect(a.destroyed()).toEqual([])
    expect(a.session.current()).toBeUndefined()
    expect(a.storage.get('perch.session.identity')).toBeUndefined()
    expect(a.storage.get('perch.session.refresh')).toBeUndefined()
    expect(a.session.notice()).toBe('resend-after-sign-in')
    expect(a.storage.get('perch.session.signing-out')).toBeUndefined()
  })

  it('waits for a write another tab admitted before the barrier, and keeps the database it then holds', async () => {
    let holding = false
    let releaseAppend = () => {}
    const appendHeld = new Promise<void>((resolve) => {
      releaseAppend = resolve
    })
    const { a, b, locks } = await twoTabs({
      online: true,
      wrapB: (local) =>
        interceptQueries(local, (text) =>
          holding && text.includes('_replica_outbox SET') ? appendHeld : undefined,
        ),
    })

    holding = true

    // B admits a command before any sign-out began; its append is slow to become durable.
    const writing = b.session.writePath.run(createProfile, aProfile())
    const signingOut = a.session.signOut()

    // A drains an outbox without B's row, the gateway signs A out and closes, and A asks for
    // the write lock before it reads what is unsent: B's write holds it.
    await vi.waitFor(() => expect(a.stub.signOuts()).toBe(1))
    await vi.waitFor(() =>
      expect(locks.waiting(writeLockName(ann.identity.id), 'exclusive')).toBe(true),
    )

    // Only now is B's change durable.
    releaseAppend()

    expect((await writing).isOk()).toBe(true)
    expect((await signingOut)._unsafeUnwrap()).toBe('signed-out')
    expect(a.destroyed()).toEqual([])
    expect(a.session.current()).toBeUndefined()
    expect(a.storage.get('perch.session.identity')).toBeUndefined()
    expect(a.session.notice()).toBe('resend-after-sign-in')
  })

  it('refuses every write while it cleans up after refused keys, the one made during its outbox check included', async () => {
    let holding = false
    let reached = () => {}
    let releaseRead = () => {}
    const atRead = new Promise<void>((resolve) => {
      reached = resolve
    })
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const booted = await world({
      storage,
      online: true,
      wrap: (local) =>
        interceptQueries(local, (text) => {
          if (!holding || !text.includes('FROM _replica_outbox')) {
            return undefined
          }

          holding = false
          reached()

          return readHeld
        }),
    })
    const { session, stub, destroyed } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    // The gateway refuses the keys; the cleanup holds the write lock and reads the outbox.
    holding = true
    stub.endWith('unauthorized')
    await atRead

    const barrier = storage.get('perch.session.signing-out')
    const writing = session.writePath.run(createProfile, aProfile())

    // Nothing is unsent: the cleanup deletes the database.
    releaseRead()

    expect((await writing)._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'signing out',
    })
    expect(barrier).toBeDefined()
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(session.current()).toBeUndefined()
    await vi.waitFor(() => expect(storage.get('perch.session.signing-out')).toBeUndefined())
  })

  it('refuses a write that waited for the lock when a sign-out began or its space went meanwhile', async () => {
    const locks = new FakeLocks()
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const booted = await world({ storage, locks, online: false })
    const { session, clock } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

    const space = session.space() ?? expect.unreachable('a space')
    const lock = writeLockName(ann.identity.id)

    // Another tab's sign-out holds the write lock; a write admitted before its barrier waits.
    const letGo = holdWriteLock(locks)
    const waiting = session.writePath.run(createProfile, aProfile())

    await vi.waitFor(() => expect(locks.waiting(lock, 'shared')).toBe(true))
    storage.set('perch.session.signing-out', String(clock.now()))
    letGo()

    expect((await waiting)._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'signing out',
    })
    // Nothing reached the database.
    expect((await space.unsent())._unsafeUnwrap()).toBe(false)

    storage.remove('perch.session.signing-out')

    // A write waits again, and another tab signs the identity out meanwhile.
    const letGoAgain = holdWriteLock(locks)
    const late = session.writePath.run(createProfile, aProfile())

    await vi.waitFor(() => expect(locks.waiting(lock, 'shared')).toBe(true))
    storage.changeElsewhere('perch.session.identity', undefined)
    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    letGoAgain()

    expect((await late)._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'signed out',
    })
  })

  it('keeps the database for the next sign-in when another tab never lets its write go', async () => {
    const locks = new FakeLocks()
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const booted = await world({ storage, locks, online: true })
    const { session, stub, destroyed, driveClock } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    // A frozen tab holds a write it never finishes.
    void locks.request(
      writeLockName(ann.identity.id),
      { mode: 'shared' },
      () => new Promise(() => {}),
    )

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(stub.signOuts()).toBe(1)
    expect(destroyed()).toEqual([])
    expect(session.current()).toBeUndefined()
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(session.notice()).toBe('resend-after-sign-in')
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
  })

  it("refuses every tab's commands while a sign-out is under way, until the database is gone", async () => {
    const { a, b } = await twoTabs({ online: true })
    const received = a.stub.keepOpenOnSignOut()
    const signingOut = a.session.signOut()

    await received

    for (const tab of [a, b]) {
      const refused = await tab.session.writePath.run(createProfile, aProfile())

      expect(refused._unsafeUnwrapErr()).toMatchObject({
        code: 'data:WRITE_REJECTED',
        message: 'signing out',
      })
    }

    a.stub.endWith('signed-out')

    expect((await signingOut)._unsafeUnwrap()).toBe('signed-out')
    expect(a.destroyed()).toEqual([ann.identity.id])
    expect(a.storage.get('perch.session.signing-out')).toBeUndefined()
  })

  it('lifts the barrier when the sign-out ends offline, so the other tab writes again', async () => {
    const { a, b, storage } = await twoTabs({ online: false })

    // A change the device cannot send: the sign-out asks first.
    expect((await a.session.writePath.run(createProfile, aProfile())).isOk()).toBe(true)

    const signingOut = a.session.signOut()

    await vi.waitFor(() => expect(storage.get('perch.session.signing-out')).toBeDefined())
    expect(
      (await b.session.writePath.run(createProfile, aProfile()))._unsafeUnwrapErr().message,
    ).toBe('signing out')

    expect((await a.driveClock(signingOut))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(storage.get('perch.session.signing-out')).toBeUndefined()

    const written = await b.session.writePath.run(
      createProfile,
      aProfile(identityIdFactory.create()),
    )

    expect(written.isOk()).toBe(true)
    expect(a.destroyed()).toEqual([])
  })

  it('holds back the writes of a tab that hears of the sign-out before its storage shows it', async () => {
    const { a, b } = await twoTabs({ online: false, hints: true, ownStorageOfB: true })

    expect((await a.session.writePath.run(createProfile, aProfile())).isOk()).toBe(true)

    const signingOut = a.session.signOut()

    await settle()
    expect(b.storage.get('perch.session.signing-out')).toBeUndefined()
    expect(
      (await b.session.writePath.run(createProfile, aProfile()))._unsafeUnwrapErr().message,
    ).toBe('signing out')

    // The sign-out ends with the device signed in: a `kick` lifts the barrier.
    expect((await a.driveClock(signingOut))._unsafeUnwrap()).toBe('needs-confirmation')

    const written = await b.session.writePath.run(
      createProfile,
      aProfile(identityIdFactory.create()),
    )

    expect(written.isOk()).toBe(true)
  })

  it('stops holding writes back once a sign-out has run for a minute, as when its tab went away', async () => {
    const { session, storage, clock } = await bootSession({ saved: ann, online: false })

    storage.set('perch.session.signing-out', String(clock.now()))

    expect(
      (await session.writePath.run(createProfile, aProfile()))._unsafeUnwrapErr().message,
    ).toBe('signing out')

    await clock.advance(59_999)

    expect((await session.writePath.run(createProfile, aProfile())).isErr()).toBe(true)

    await clock.advance(1)

    expect((await session.writePath.run(createProfile, aProfile())).isOk()).toBe(true)
  })

  it('signs out from a tab that follows: it takes the lead and the gateway hears the sign-out', async () => {
    const storage = memoryStorage()
    const locks = new FakeLocks()

    saveDevice(storage, ann)

    const leading = await world({ storage, locks })

    expect((await leading.session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(leading.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    const following = await world({ storage, locks, gateway: leading.gateway })

    expect((await following.session.restore()).isOk()).toBe(true)
    await settle()
    expect(following.states.at(-1)).toEqual({ leader: false, channel: 'down' })

    expect((await following.session.signOut())._unsafeUnwrap()).toBe('signed-out')
    expect(leading.stub.signOuts()).toBe(1)
    expect(following.destroyed()).toEqual([ann.identity.id])
  })

  it('forgets the device and its data when the gateway refuses its keys and nothing is unsent', async () => {
    const { session, gateway, storage, destroyed } = await bootSession({ saved: ann, online: true })

    gateway.endWith('unauthorized')

    // The outbox is read first: it decides whether the database goes.
    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(storage.get('perch.session.notice')).toBeUndefined()
    expect(session.notice()).toBeUndefined()
    expect(gateway.signOuts()).toBe(0)
  })

  it('keeps the database with unsent changes when the gateway refuses the keys, and asks to sign in again', async () => {
    const { session, gateway, storage, destroyed, writeOffline } = await bootSession({
      saved: ann,
      online: false,
    })

    await writeOffline()
    gateway.endWith('unauthorized')

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(session.space()).toBeUndefined()
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(storage.get('perch.session.refresh')).toBeUndefined()
    expect(storage.get('perch.session.notice')).toBe('resend-after-sign-in')
    expect(session.notice()).toBe('resend-after-sign-in')
    await settle()
    expect(destroyed()).toEqual([])
    expect(gateway.signOuts()).toBe(0)

    session.clearNotice()

    expect(session.notice()).toBeUndefined()
    expect(storage.get('perch.session.notice')).toBeUndefined()
  })

  it('keeps the database when the gateway refuses the keys and the outbox cannot be read', async () => {
    const { session, gateway, storage, destroyed, failures } = await bootSession({
      saved: ann,
      online: true,
    })
    const space = session.space() ?? expect.unreachable('a space')
    const unreadable = dataError('data:QUERY_FAILED', 'could not read the outbox')

    vi.spyOn(space, 'unsent').mockReturnValue(errAsync(unreadable))
    gateway.endWith('unauthorized')

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(session.notice()).toBe('resend-after-sign-in')
    expect(storage.get('perch.session.identity')).toBeUndefined()
    await settle()
    expect(destroyed()).toEqual([])
    expect(failures.splice(0)).toEqual([unreadable])
  })

  it('stays signed in with its keys and data when the gateway refuses the protocol', async () => {
    const { session, gateway, storage, destroyed, failures, states } = await bootSession({
      saved: ann,
      online: true,
    })

    gateway.endWith('protocol')
    await settle()

    expect(session.current()?.id).toBe(ann.identity.id)
    expect(storage.get('perch.session.refresh')).toBe(ann.tokens.refresh)
    expect(storage.get('perch.session.identity')).toContain(ann.identity.id)
    expect(session.notice()).toBeUndefined()
    expect(destroyed()).toEqual([])
    expect(states.at(-1)).toEqual({ leader: true, channel: 'down' })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:SYNC_STOPPED'])
  })

  it('keeps the keys the gateway renews and hands the saved ones to the channel', async () => {
    const { storage, contexts } = await bootSession({ saved: ann, online: true })
    const [context] = contexts()

    expect(context?.credentials()).toEqual(ann.tokens)

    context?.onTokens({ access: 'access-2', refresh: 'refresh-2' })

    expect(storage.get('perch.session.token')).toBe('access-2')
    expect(storage.get('perch.session.refresh')).toBe('refresh-2')
    expect(context?.credentials()).toEqual({ access: 'access-2', refresh: 'refresh-2' })
  })

  it('closes its space, deleting nothing, when another tab signs the identity out', async () => {
    const { session, storage, destroyed, states } = await bootSession({ saved: ann })

    storage.changeElsewhere('perch.session.identity', undefined)
    await settle()

    expect(session.current()).toBeUndefined()
    expect(states.at(-1)).toEqual({ leader: false, channel: 'down' })
    await settle()
    expect(destroyed()).toEqual([])
  })

  it('stays signed out of a saved identity the stored keys do not describe', async () => {
    const storage = memoryStorage()

    storage.set('perch.session.identity', '{"id":"not-an-identity","email":"x"}')
    storage.set('perch.session.token', 'access-x')

    const { session, opened } = await world({ storage })

    expect((await session.restore())._unsafeUnwrap()).toBeUndefined()
    expect(opened()).toEqual([])
    expect(storage.get('perch.session.token')).toBeUndefined()
  })

  it('signs out even when the local database cannot be deleted, and reports it', async () => {
    const { session, storage, writeOffline, driveClock } = await bootSession({ saved: ann })
    const space = session.space() ?? expect.unreachable('a space')
    const seen: Array<string | undefined> = []

    await writeOffline()
    vi.spyOn(space, 'destroy').mockImplementation(async () => {
      await space.close()
      throw new Error('the store is locked')
    })
    session.subscribe((user) => seen.push(user?.email))

    const result = await driveClock(session.signOut({ forgetUnsent: true }))

    expect(result._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(session.current()).toBeUndefined()
    expect(session.space()).toBeUndefined()
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(seen).toEqual([undefined])
  })

  it('takes a sign-out made during a sign-in after it, leaving the device signed out', async () => {
    const holding = holdingRegionLoads()
    const { session, driveClock } = await world({ wrap: holding.wrap, online: false })

    expect((await session.signUp(annSignUp)).isOk()).toBe(true)
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    holding.hold()

    const signingIn = session.signIn(annSignUp)

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    const signingOut = session.signOut()

    holding.release()

    expect((await signingIn).isOk()).toBe(true)
    expect((await driveClock(signingOut))._unsafeUnwrap()).toBe('signed-out')
    expect(session.current()).toBeUndefined()
    expect(session.space()).toBeUndefined()
  })

  it('runs overlapping sign-ins one after the other, so the later one owns the session and its keys', async () => {
    const holding = holdingRegionLoads()
    const { session, storage, auth } = await world({ wrap: holding.wrap })

    expect((await auth.signUp(bobSignUp)).isOk()).toBe(true)
    expect((await auth.signUp(annSignUp)).isOk()).toBe(true)

    holding.hold()

    const first = session.signIn(bobSignUp)

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    const bobsKey = storage.get('perch.session.refresh')
    const second = session.signIn(annSignUp)

    // Ann's sign-in waits for Bob's: it has not touched the saved keys.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(storage.get('perch.session.refresh')).toBe(bobsKey)
    holding.release()

    expect((await first)._unsafeUnwrap().email).toBe(bobSignUp.email)
    expect((await second)._unsafeUnwrap().email).toBe(annSignUp.email)
    expect(session.current()?.email).toBe(annSignUp.email)
    expect(session.space()?.identity.email).toBe(annSignUp.email)
    expect(storage.get('perch.session.identity')).toContain(annSignUp.email)
  })

  it('attaches nothing after close, neither the transition running nor those waiting behind it', async () => {
    const holding = holdingRegionLoads()
    const { session, auth } = await world({ wrap: holding.wrap })

    expect((await auth.signUp(bobSignUp)).isOk()).toBe(true)
    expect((await auth.signUp(annSignUp)).isOk()).toBe(true)

    holding.hold()

    const running = session.signIn(bobSignUp)

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    const waiting = session.signIn(annSignUp)
    const closing = session.close()

    holding.release()
    await closing

    expect((await running).isErr()).toBe(true)
    expect((await waiting).isErr()).toBe(true)
    expect(session.current()).toBeUndefined()
    expect(session.space()).toBeUndefined()
  })

  it('does not run a sign-in called just before close', async () => {
    const { session } = await world()

    expect((await session.signUp(annSignUp)).isOk()).toBe(true)

    const pending = session.signIn(annSignUp)

    await session.close()

    expect((await pending).isErr()).toBe(true)
    expect(session.space()).toBeUndefined()
  })

  it('tells subscribers when the signed-in user changes', async () => {
    const { session, driveClock } = await world({ online: false })
    const seen: Array<string | undefined> = []

    session.subscribe((user) => seen.push(user?.email))
    expect((await session.signUp(annSignUp)).isOk()).toBe(true)
    expect((await driveClock(session.signOut())).isOk()).toBe(true)

    expect(seen).toEqual([annSignUp.email, undefined])
  })

  it('reports the failure of a sign-in the gateway refuses, staying signed out', async () => {
    const { session, opened } = await world()

    const refused: DataError = (await session.signIn(annSignUp))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:INVALID_CREDENTIALS')
    expect(session.current()).toBeUndefined()
    expect(opened()).toEqual([])
  })

  it("follows the tab's visibility in the leader's sync cadence", async () => {
    const { session, setVisibility } = await bootSession({ saved: ann })
    const sync = session.space()?.sync ?? expect.unreachable('this tab leads')
    const seen = vi.spyOn(sync, 'visibility')

    setVisibility('hidden')
    setVisibility('visible')

    expect(seen.mock.calls).toEqual([['hidden'], ['visible']])
  })
})

describe('SessionService memberships', () => {
  it('a sign-in keeps the memberships the gateway answered with, and the first by key is the current tenant', async () => {
    const { session, storage, tenantsOpened } = await world({ memberships: [globex, acme] })
    const heard: Array<string | undefined> = []

    session.subscribeMemberships(() => heard.push(session.currentTenant()?.tenant.key))

    const user = (await session.signUp(annSignUp))._unsafeUnwrap()

    expect(session.memberships()).toEqual([globex, acme])
    expect(session.currentTenant()).toEqual(acme)
    expect(savedMemberships(storage, user.id)).toEqual([globex, acme])
    expect([...tenantsOpened()].sort()).toEqual(['acme', 'globex'])
    expect(session.space()?.tenants()).toEqual(['acme', 'globex'])
    expect(heard).toContain('acme')
  })

  it('a memberships message from the channel updates storage and the space', async () => {
    const { session, storage, contexts, tenantsOpened } = await bootSession({ saved: ann })
    const [context] = contexts()

    expect(session.memberships()).toEqual([])
    expect(session.currentTenant()).toBeUndefined()

    context?.onMemberships([acme])

    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['acme']))
    expect(session.memberships()).toEqual([acme])
    expect(session.currentTenant()).toEqual(acme)
    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
    expect(tenantsOpened()).toEqual(['acme'])
  })

  it("another tab's memberships change (storage event) updates the space", async () => {
    const { session, storage } = await bootSession({ saved: ann })
    const elsewhere = memoryStorage()

    saveMemberships(elsewhere, ann.identity.id, [acme])
    storage.changeElsewhere('perch.session.memberships', elsewhere.get('perch.session.memberships'))

    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['acme']))
    expect(session.memberships()).toEqual([acme])
    expect(session.currentTenant()).toEqual(acme)
  })

  it('selectTenant is kept across restore', async () => {
    const storage = memoryStorage()

    saveDevice(storage, annIn([acme, globex]))

    const first = await world({ storage, online: false })

    expect((await first.session.restore()).isOk()).toBe(true)
    expect(first.session.currentTenant()).toEqual(acme)

    first.session.selectTenant('globex')

    expect(first.session.currentTenant()).toEqual(globex)
    expect(first.session.space()?.currentTenant()).toBe('globex')
    await first.session.close()

    const again = await world({ storage, online: false })

    expect((await again.session.restore()).isOk()).toBe(true)
    expect(again.session.memberships()).toEqual([acme, globex])
    expect(again.session.currentTenant()).toEqual(globex)
    expect(again.session.space()?.currentTenant()).toBe('globex')
  })

  it('sign-out deletes the tenant databases too', async () => {
    const { session, destroyed, tenantsDestroyed, driveClock } = await bootSession({
      saved: annIn([acme, globex]),
    })

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(destroyed()).toEqual([ann.identity.id])
    expect([...tenantsDestroyed()].sort()).toEqual(['acme', 'globex'])
  })

  it('the sign-in page keeps nothing of the memberships after sign-out', async () => {
    const { session, storage, driveClock } = await bootSession({ saved: annIn([acme, globex]) })
    let heard = 0

    session.selectTenant('globex')
    session.subscribeMemberships(() => {
      heard += 1
    })

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(session.memberships()).toEqual([])
    expect(session.currentTenant()).toBeUndefined()
    expect(storage.get('perch.session.memberships')).toBeUndefined()
    expect(storage.get('perch.session.tenant')).toBeUndefined()
    expect(heard).toBeGreaterThan(0)
  })

  it('renewKeys in the leading tab connects again and resolves once the gateway handed new keys', async () => {
    const { session, storage, gateway } = await bootSession({ saved: ann, online: true })

    gateway.renewAtNextHello({ access: 'access-2', refresh: 'refresh-2' })

    expect(await session.renewKeys()).toBe(true)
    expect(storage.get('perch.session.token')).toBe('access-2')
    expect(storage.get('perch.session.refresh')).toBe('refresh-2')
  })

  it('renewKeys in a following tab asks the leader and resolves once the access key changed in storage', async () => {
    const { a, b, storage } = await twoTabs({ online: true, hints: true })

    a.stub.renewAtNextHello({ access: 'access-2', refresh: 'refresh-2' })

    const renewing = b.session.renewKeys()

    // The leader connected again and kept the new keys; the browser tells the other tabs.
    await vi.waitFor(() => expect(storage.get('perch.session.token')).toBe('access-2'))
    storage.changeElsewhere('perch.session.token', 'access-2')

    expect(await renewing).toBe(true)
  })

  it('renewKeys resolves false when no new keys come within 10 seconds', async () => {
    const { session, storage, driveClock } = await bootSession({ saved: ann, online: true })

    expect(await driveClock(session.renewKeys())).toBe(false)
    expect(storage.get('perch.session.token')).toBe(ann.tokens.access)
  })
})
