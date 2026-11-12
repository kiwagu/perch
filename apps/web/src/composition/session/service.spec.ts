import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import {
  type IdentityId,
  identityIdFactory,
  noteIdFactory,
  profileIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import { CLOSE, type Membership } from '@workspace/replica/protocol'
import { writeLockName } from '@workspace/replica/sync'
import { type FakeHintChannel, FakeLocks, interceptRegionResets } from '@workspace/replica/testing'

import { profileCommands } from '../../features/user/presentation/pages/profile/profile.model.gen'
import { fakeGatewayAuth, verifiedElsewhere } from '../__fixtures__/gateway-auth'
import { createNote, organisationShape } from '../__fixtures__/note'
import { createProfile, profileById } from '../__fixtures__/profile'
import {
  browserDatabases,
  openTestWorld,
  signUpVerified,
  TEST_DEVICE_LABEL,
  type TestWorld,
  type TestWorldOptions,
} from '../__fixtures__/session'
import { elsewhere, signedIn, signedOutElsewhere } from '../__fixtures__/signed-in'
import type { GatewayAuth, SignedInDevice } from '../gateway-auth'
import {
  addPendingRevoke,
  CURRENT_KEY,
  type KeptDevice,
  type KeyValueStorage,
  membershipsKeyOf,
  memoryStorage,
  newSignInId,
  pendingRevokes,
  type SignInOwner,
  saveDevice,
  savedIdentity,
  savedMemberships,
  savedSession,
  savedTenant,
  savedTenantDatabases,
  savedToken,
  saveMemberships,
  signedInKeyOf,
  TENANT_DATABASES_KEY,
} from '../storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const annSignUp = { email: 'ann@example.test', password: 'Pass-word-1', name: 'Ann', locale: 'en' }

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

const globex: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'globex', name: 'Globex' },
  role: 'member',
}

/** Ann's token as a sign-out on device `device-1` left it to sign out. */
const annLeft = { token: ann.token, device: 'device-1' }

/** Ann's device as a sign-in left it, a member of `memberships`. */
const annIn = (memberships: readonly Membership[]): KeptDevice => ({ ...ann, memberships })

/** A gateway whose sign-in always answers `device`, and which takes no sign-up and no link. */
const signingIn = (device: SignedInDevice): GatewayAuth => ({
  // What else the gateway does is not in these tests.
  ...fakeGatewayAuth(),
  signUp: () => errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected')),
  signIn: () => okAsync(device),
  verifyEmail: () => errAsync(dataError('data:LINK_INVALID', 'not in this test')),
  resendVerification: () => errAsync(dataError('data:WRITE_REJECTED', 'not in this test')),
  signOut: () => okAsync(undefined),
})

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

async function world(options: TestWorldOptions = {}): Promise<TestWorld> {
  const opened = await openTestWorld(options)

  worlds.push(opened)

  return opened
}

/** The sign-in of `identity` that `storage` keeps now, as the owner of what it keeps. */
function signInOf(storage: KeyValueStorage, identity: IdentityId): SignInOwner {
  return { signIn: savedSession(storage)?.signIn ?? expect.unreachable('a sign-in kept'), identity }
}

/** A device database on which every region reset fails, as on a broken database. */
const refuseResets = (local: LocalDb) =>
  interceptRegionResets(local, () => {
    throw new Error('the database refuses the reset')
  })

/** Boots a session as a page load does, with `saved` kept from an earlier sign-in, and waits until its tab leads. */
async function bootSession(options: {
  readonly saved: KeptDevice | undefined
  readonly online?: boolean
  /** Wraps the device's database connections, e.g. to make a query fail. */
  readonly wrap?: (local: LocalDb) => LocalDb
}) {
  const storage = memoryStorage()

  if (options.saved) {
    signedIn(storage, options.saved)
  }

  const booted = await world({
    storage,
    online: options.online ?? false,
    ...(options.wrap ? { wrap: options.wrap } : {}),
  })
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
  /** Whether the browser says it has a network; as `online` by default. */
  readonly network?: boolean
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
    ...(options.network === undefined ? {} : { network: options.network }),
    ...(options.hints ? { hints: new Set<FakeHintChannel>() } : {}),
  }

  const kept = signedIn(storage, ann)

  const a = await world({ ...shared, storage })

  expect((await a.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() =>
    expect(a.states.at(-1)).toEqual({ leader: true, channel: options.online ? 'up' : 'down' }),
  )

  const storageOfB = options.ownStorageOfB ? memoryStorage() : storage

  // Tab b's own copy holds the same sign-in.
  if (options.ownStorageOfB) {
    saveDevice(storageOfB, kept.signIn, ann)
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

  it('signs out online: drains, signs out through the gateway, deletes the local database and the token', async () => {
    const { session, storage, destroyed, gateway, writeOffline } = await bootSession({
      saved: ann,
      online: true,
    })

    await writeOffline()

    expect((await session.signOut())._unsafeUnwrap()).toBe('signed-out')
    expect(gateway.signOuts()).toBe(1)
    expect(destroyed()).toEqual([ann.identity.id])
    expect(savedSession(storage)).toBeUndefined()
    expect(savedIdentity(storage)).toBeUndefined()
    // The gateway signed the token out: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
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
    expect(savedToken(storage)).toBe(ann.token)
    expect(destroyed()).toEqual([])

    expect((await driveClock(session.signOut({ forgetUnsent: true })))._unsafeUnwrap()).toBe(
      'signed-out',
    )
    expect(session.current()).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(destroyed()).toEqual([ann.identity.id])
  })

  it('asks at once, waiting for no channel, when the browser has no network', async () => {
    const { session, writeOffline } = await bootSession({ saved: ann, online: false })

    await writeOffline()

    // The clock stands still: a sign-out waiting for the channel would never answer.
    expect((await session.signOut())._unsafeUnwrap()).toBe('needs-confirmation')
  })

  it("asks before signing out offline while an organisation's region holds an unsent change", async () => {
    const { session, destroyed, driveClock } = await bootSession({
      saved: annIn([acme]),
      online: false,
    })

    expect(
      (
        await session.writePath.run(createNote, {
          id: noteIdFactory.create(),
          author: ann.identity.id,
          text: 'not sent',
        })
      ).isOk(),
    ).toBe(true)

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(destroyed()).toEqual([])
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

  // A database that answers late lets no wait of the sign-out run out before its checks: the
  // clock the test drives moves on only while no query is in flight.
  it.each([0, 25])(
    'asks before signing out while a change fails to persist, though the outbox reads empty (each query %i ms late)',
    async (lateMs) => {
      let failAppend = false
      const storage = memoryStorage()

      signedIn(storage, ann)

      const booted = await world({
        storage,
        wrap: (local) =>
          interceptQueries(local, (text) => {
            if (failAppend && text.includes('_replica_outbox SET')) {
              throw new Error('the disk is full')
            }

            return failAppend && lateMs > 0
              ? new Promise<void>((resolve) => setTimeout(resolve, lateMs))
              : undefined
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
    },
  )

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
    expect(savedToken(storage)).toBe(ann.token)
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
    // A region whose reset fails stops with the changes the gateway refused.
    const booted = await bootSession({ saved: ann, online: true, wrap: refuseResets })
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

  it('publishes a push the gateway rejects, and the reload of its region, with the error log', async () => {
    const booted = await bootSession({ saved: ann, online: true })
    const { gateway, failures, writeOffline, published } = booted

    gateway.rejectEverything()
    await writeOffline()
    // Its rollback is refused too: the region is loaded again from the server, which is
    // published as well, and nothing stops.
    await vi.waitFor(() => expect(published).toHaveLength(2))

    const region = `identity:${ann.identity.id}`

    expect(published).toMatchObject([
      {
        name: 'sync.change-rejected',
        payload: { region, reason: 'foreign-table', reloaded: false },
        actorId: ann.identity.id,
      },
      {
        name: 'sync.changes-reloaded',
        payload: { region, reason: 'foreign-table', reloaded: true },
        actorId: ann.identity.id,
      },
    ])
    expect(failures.map((failure) => failure.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])

    failures.splice(0)
  })

  it('publishes a sync protocol the gateway no longer takes, keeps it, and stays signed in', async () => {
    const { session, gateway, failures, published } = await bootSession({
      saved: ann,
      online: true,
    })

    expect(session.protocolRefused()).toBe(false)

    gateway.endWith('protocol')

    await vi.waitFor(() =>
      expect(published).toMatchObject([
        { name: 'sync.protocol-refused', payload: null, actorId: ann.identity.id },
      ]),
    )
    // Kept for a frame that starts listening later, until the page loads again.
    expect(session.protocolRefused()).toBe(true)
    // The sync engine stopped and said so; nothing else changes on the device.
    expect(failures.map((failure) => failure.code)).toEqual(['data:SYNC_STOPPED'])
    expect(session.current()?.id).toBe(ann.identity.id)

    failures.splice(0)
  })

  it('asks before signing out when the region stops syncing during the sign-out', async () => {
    const booted = await bootSession({ saved: ann, online: true, wrap: refuseResets })
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
    expect(savedIdentity(a.storage)).toBeUndefined()
    expect(savedSession(a.storage)).toBeUndefined()
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
    expect(savedIdentity(a.storage)).toBeUndefined()
    expect(a.session.notice()).toBe('resend-after-sign-in')
  })

  it('refuses every write while it cleans up after a refused token, the one made during its outbox check included', async () => {
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

    signedIn(storage, ann)

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

    // The gateway refuses the token; the cleanup holds the write lock and reads the outbox.
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

    signedIn(storage, ann)

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
    signedOutElsewhere(storage)
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

    signedIn(storage, ann)

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
    expect(savedIdentity(storage)).toBeUndefined()
    expect(session.notice()).toBe('resend-after-sign-in')
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
    // The gateway signed the token out before the database was kept: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
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
    // The gateway is out of reach on a network: the sign-out waits for the channel meanwhile.
    const { a, b, storage } = await twoTabs({ online: false, network: true })

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
    // The gateway is out of reach on a network: the sign-out waits for the channel meanwhile.
    const { a, b } = await twoTabs({
      online: false,
      network: true,
      hints: true,
      ownStorageOfB: true,
    })

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

    signedIn(storage, ann)

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

  it('forgets the device and its data when the gateway refuses its token and nothing is unsent', async () => {
    const { session, gateway, storage, destroyed } = await bootSession({ saved: ann, online: true })

    gateway.endWith('unauthorized')

    // The outbox is read first: it decides whether the database goes.
    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(savedIdentity(storage)).toBeUndefined()
    expect(session.notice()).toBeUndefined()
    expect(gateway.signOuts()).toBe(0)
    // A refused token is dead: nothing waits to be signed out.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
  })

  it('keeps the database with unsent changes when the gateway refuses the token, and asks to sign in again', async () => {
    const { session, gateway, storage, destroyed, writeOffline } = await bootSession({
      saved: ann,
      online: false,
    })

    await writeOffline()
    gateway.endWith('unauthorized')

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(session.space()).toBeUndefined()
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(storage.get('perch.session.notice.0.resend-after-sign-in')).toBe('resend-after-sign-in')
    expect(session.notice()).toBe('resend-after-sign-in')
    await settle()
    expect(destroyed()).toEqual([])
    expect(gateway.signOuts()).toBe(0)

    session.clearNotice()

    expect(session.notice()).toBeUndefined()
    expect(storage.get('perch.session.notice.0.resend-after-sign-in')).toBeUndefined()
  })

  it('keeps the database when the gateway refuses the token and the outbox cannot be read', async () => {
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
    expect(savedIdentity(storage)).toBeUndefined()
    await settle()
    expect(destroyed()).toEqual([])
    expect(failures.splice(0)).toEqual([unreadable])
  })

  it('stays signed in with its token and data when the gateway refuses the protocol', async () => {
    const { session, gateway, storage, destroyed, failures, states } = await bootSession({
      saved: ann,
      online: true,
    })

    gateway.endWith('protocol')
    await settle()

    expect(session.current()?.id).toBe(ann.identity.id)
    expect(savedToken(storage)).toBe(ann.token)
    expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
    expect(session.notice()).toBeUndefined()
    expect(destroyed()).toEqual([])
    expect(states.at(-1)).toEqual({ leader: true, channel: 'down' })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:SYNC_STOPPED'])
  })

  it("hands the saved token to the channel while it is the identity's own", async () => {
    const { storage, contexts } = await bootSession({ saved: ann, online: true })
    const [context] = contexts()

    expect(context?.credentials()).toEqual({ token: ann.token })

    // Another sign-in's token is not this channel's to present, even read while the identity
    // saved is still its own: another tab signed the identity in again, unheard here yet.
    signedIn(storage, { identity: ann.identity, token: 'token-ann-again' })

    expect(savedIdentity(storage)?.id).toBe(ann.identity.id)
    expect(context?.credentials()).toBeUndefined()
  })

  it('closes its space, deleting nothing, when another tab signs the identity out', async () => {
    const { session, storage, destroyed, states } = await bootSession({ saved: ann })

    signedOutElsewhere(storage)
    await settle()

    expect(session.current()).toBeUndefined()
    expect(states.at(-1)).toEqual({ leader: false, channel: 'down' })
    await settle()
    expect(destroyed()).toEqual([])
  })

  it('stays signed out of a saved identity the stored value does not describe', async () => {
    const storage = memoryStorage()
    const signIn = newSignInId()

    storage.set(CURRENT_KEY, signIn)
    storage.set(
      signedInKeyOf(signIn),
      JSON.stringify({ identity: 'not-an-identity', email: 'x', token: 'token-x' }),
    )

    const { session, opened } = await world({ storage })

    expect((await session.restore())._unsafeUnwrap()).toBeUndefined()
    expect(opened()).toEqual([])
    expect(storage.get(signedInKeyOf(signIn))).toBeUndefined()
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
    expect(savedIdentity(storage)).toBeUndefined()
    expect(seen).toEqual([undefined])
  })

  it('takes a sign-out made during a sign-in after it, leaving the device signed out', async () => {
    const holding = holdingRegionLoads()
    const auth = fakeGatewayAuth()
    const { session, driveClock } = await world({ wrap: holding.wrap, online: false, auth })

    expect((await signUpVerified(session, auth, annSignUp)).isOk()).toBe(true)
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

  it('runs overlapping sign-ins one after the other: a later one of another account waits, then is refused', async () => {
    const holding = holdingRegionLoads()
    const auth = fakeGatewayAuth()
    const { session, storage } = await world({ wrap: holding.wrap, auth })

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)

    holding.hold()

    const first = session.signIn(bobSignUp)

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    const bobsToken = savedToken(storage)
    const second = session.signIn(annSignUp)

    // Ann's sign-in waits for Bob's: it has not touched the saved token.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(savedToken(storage)).toBe(bobsToken)
    holding.release()

    // One account per browser: Bob is signed in once Ann's turn comes.
    expect((await first)._unsafeUnwrap().email).toBe(bobSignUp.email)
    expect((await second)._unsafeUnwrapErr().code).toBe('data:OTHER_ACCOUNT')
    expect(session.current()?.email).toBe(bobSignUp.email)
    expect(session.space()?.identity.email).toBe(bobSignUp.email)
    expect(savedIdentity(storage)?.email).toBe(bobSignUp.email)
    expect(savedToken(storage)).toBe(bobsToken)
  })

  it('attaches nothing after close, neither the transition running nor those waiting behind it', async () => {
    const holding = holdingRegionLoads()
    const auth = fakeGatewayAuth()
    const { session } = await world({ wrap: holding.wrap, auth })

    expect((await verifiedElsewhere(auth, bobSignUp)).isOk()).toBe(true)
    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)

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
    const auth = fakeGatewayAuth()
    const { session } = await world({ auth })

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)

    const pending = session.signIn(annSignUp)

    await session.close()

    expect((await pending).isErr()).toBe(true)
    expect(session.space()).toBeUndefined()
  })

  it('tells subscribers when the signed-in user changes', async () => {
    const auth = fakeGatewayAuth()
    const { session, driveClock } = await world({ online: false, auth })
    const seen: Array<string | undefined> = []

    session.subscribe((user) => seen.push(user?.email))
    expect((await signUpVerified(session, auth, annSignUp)).isOk()).toBe(true)
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
    const auth = fakeGatewayAuth()
    const { session, storage, tenantsOpened } = await world({ memberships: [globex, acme], auth })
    const heard: Array<string | undefined> = []

    session.subscribeMemberships(() => heard.push(session.currentTenant()?.tenant.key))

    const user = (await signUpVerified(session, auth, annSignUp))._unsafeUnwrap()

    expect(session.memberships()).toEqual([globex, acme])
    expect(session.currentTenant()).toEqual(acme)
    expect(savedMemberships(storage, signInOf(storage, user.id))).toEqual([globex, acme])
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
    expect(savedMemberships(storage, signInOf(storage, ann.identity.id))).toEqual([acme])
    expect(tenantsOpened()).toEqual(['acme'])
  })

  it("another tab's memberships change (storage event) updates the space", async () => {
    const { session, storage } = await bootSession({ saved: ann })

    saveMemberships(elsewhere(storage), signInOf(storage, ann.identity.id), [acme])

    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['acme']))
    expect(session.memberships()).toEqual([acme])
    expect(session.currentTenant()).toEqual(acme)
  })

  it('selectTenant is kept across restore', async () => {
    const storage = memoryStorage()

    signedIn(storage, annIn([acme, globex]))

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

  it('a tenant database retained across a refused-token sign-out is destroyed at the next sign-in when the membership is gone', async () => {
    const storage = memoryStorage()

    signedIn(storage, annIn([acme]))

    // Ann is removed from Acme while signed out: her next sign-in reads her memberships without it.
    const booted = await world({
      storage,
      online: false,
      auth: signingIn(ann),
      listMemberships: () => okAsync([]),
    })
    const { session, stub, tenantsDestroyed, tenantsDeleted, driveClock } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'down' }))
    expect(session.space()?.tenants()).toEqual(['acme'])
    expect((await session.writePath.run(createProfile, aProfile())).isOk()).toBe(true)

    // The token is refused with a change unsent: the databases stay for the next sign-in.
    stub.endWith('unauthorized')
    await vi.waitFor(() => expect(session.notice()).toBe('resend-after-sign-in'))
    await settle()
    expect(tenantsDestroyed()).toEqual([])
    expect(tenantsDeleted()).toEqual([])
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])

    expect((await session.signIn(annSignUp))._unsafeUnwrap()).toEqual(ann.identity)
    await vi.waitFor(() => expect(tenantsDeleted()).toEqual(['acme']))
    expect(session.space()?.tenants()).toEqual([])
    expect(storage.get(TENANT_DATABASES_KEY)).toBeUndefined()

    // A later sign-out leaves nothing of Acme behind, and has nothing more to delete.
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(tenantsDeleted()).toEqual(['acme'])
    expect(tenantsDestroyed()).toEqual([])
    expect(storage.get(TENANT_DATABASES_KEY)).toBeUndefined()
  })

  it("another identity's sign-in leaves the count of a database retained for the first, which goes once its membership is gone", async () => {
    const storage = memoryStorage()
    const bob: SignedInDevice = {
      identity: { id: identityIdFactory.create(), email: bobSignUp.email },
      token: 'token-bob',
    }
    // What the gateway answers each one's sign-in, and the memberships each one's token reads.
    const answers = new Map<string, SignedInDevice>([
      [annSignUp.email, ann],
      [bobSignUp.email, bob],
    ])
    const memberships = new Map<string, readonly Membership[]>([
      [ann.token, [acme]],
      [bob.token, [globex]],
    ])
    const auth: GatewayAuth = {
      ...fakeGatewayAuth(),
      signUp: () => errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected')),
      signIn: (input) =>
        okAsync(answers.get(input.email) ?? expect.unreachable(`an account for ${input.email}`)),
      verifyEmail: () => errAsync(dataError('data:LINK_INVALID', 'not in this test')),
      resendVerification: () => errAsync(dataError('data:WRITE_REJECTED', 'not in this test')),
      signOut: () => okAsync(undefined),
    }

    signedIn(storage, annIn([acme]))

    const booted = await world({
      storage,
      online: false,
      auth,
      listMemberships: (token) => okAsync(memberships.get(token) ?? []),
    })
    const { session, stub, tenantsDestroyed, tenantsDeletedOf, driveClock } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'down' }))
    expect(session.space()?.tenants()).toEqual(['acme'])
    expect((await session.writePath.run(createProfile, aProfile())).isOk()).toBe(true)

    // Ann's token is refused with a change unsent: her databases stay for her next sign-in.
    stub.endWith('unauthorized')
    await vi.waitFor(() => expect(session.notice()).toBe('resend-after-sign-in'))
    await settle()
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])

    // Bob signs in on the same browser and opens Globex: Ann's Acme stays counted.
    expect((await session.signIn(bobSignUp))._unsafeUnwrap()).toEqual(bob.identity)
    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['globex']))
    expect(savedTenantDatabases(storage, bob.identity.id)).toEqual(['globex'])
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])

    // Bob's token is refused with a change unsent too: his databases stay for his next sign-in,
    // and nobody is signed in on the browser, which lets Ann sign in (one account per browser).
    expect((await session.writePath.run(createProfile, aProfile(bob.identity.id))).isOk()).toBe(
      true,
    )
    stub.endWith('unauthorized')
    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await settle()
    expect(savedTenantDatabases(storage, bob.identity.id)).toEqual(['globex'])

    // Ann is removed from Acme while she is signed out: her next sign-in reads it no more.
    memberships.set(ann.token, [])
    expect((await session.signIn(annSignUp))._unsafeUnwrap()).toEqual(ann.identity)
    await vi.waitFor(() => expect(tenantsDeletedOf(ann.identity.id)).toEqual(['acme']))
    expect(session.space()?.tenants()).toEqual([])
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual([])
    expect(savedTenantDatabases(storage, bob.identity.id)).toEqual(['globex'])

    // Her later sign-out leaves nothing of her, and Bob's count as it was.
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(tenantsDeletedOf(ann.identity.id)).toEqual(['acme'])
    expect(tenantsDeletedOf(bob.identity.id)).toEqual([])
    expect(tenantsDestroyed()).toEqual([])
    expect(JSON.parse(storage.get(TENANT_DATABASES_KEY) ?? 'null')).toEqual({
      [bob.identity.id]: ['globex'],
    })
  })

  it('a tab on an older list asks before its sign-out deletes the database of a membership another tab saved, opened and wrote into', async () => {
    const storage = memoryStorage()
    const shared = { storage, locks: new FakeLocks(), databases: browserDatabases(), online: false }
    const holding = holdingRegionLoads()

    signedIn(storage, annIn([acme]))

    const a = await world(shared)

    expect((await a.session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(a.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

    // Tab B reads the memberships, Acme only, and starts to open; its region load waits.
    const b = await world({ ...shared, gateway: a.gateway, wrap: holding.wrap })

    holding.hold()

    const restoring = b.session.restore()

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    // Tab A hears Ann join Globex, opens its database and writes a note there, offline: unsent.
    a.contexts()[0]?.onMemberships([acme, globex])
    await vi.waitFor(() => expect(a.session.space()?.tenants()).toEqual(['acme', 'globex']))
    a.session.selectTenant('globex')
    expect(
      (
        await a.session.writePath.run(createNote, {
          id: noteIdFactory.create(),
          author: ann.identity.id,
          text: 'At Globex, unsent',
        })
      ).isOk(),
    ).toBe(true)

    holding.release()
    expect((await restoring).isOk()).toBe(true)
    expect(b.session.space()?.tenants()).toEqual(['acme'])

    // B follows the older list, yet Globex is counted and saved: what it holds counts as unsent.
    expect((await b.driveClock(b.session.signOut()))._unsafeUnwrap()).toBe('needs-confirmation')
    await settle()
    expect(b.tenantsDeleted()).toEqual([])
    expect(b.tenantsDestroyed()).toEqual([])
    expect(a.tenantsDestroyed()).toEqual([])
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme', 'globex'])
    await expect(b.session.close()).resolves.toBeUndefined()
  })

  it('a tab that opens on an older list leaves the database of a membership another tab saved and opened meanwhile', async () => {
    const storage = memoryStorage()
    const shared = { storage, locks: new FakeLocks(), databases: browserDatabases(), online: false }
    const holding = holdingRegionLoads()

    signedIn(storage, annIn([acme]))

    const a = await world(shared)

    expect((await a.session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(a.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

    // Tab B reads the memberships, Acme only, and starts to open; its region load waits.
    const b = await world({ ...shared, gateway: a.gateway, wrap: holding.wrap })

    holding.hold()

    const restoring = b.session.restore()

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    // Meanwhile the leading tab A hears Ann join Globex: it saves the memberships, then counts
    // Globex's database and opens it.
    a.contexts()[0]?.onMemberships([acme, globex])
    await vi.waitFor(() => expect(a.session.space()?.tenants()).toEqual(['acme', 'globex']))
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme', 'globex'])

    // B opens on its older list, yet leaves Globex's database, which A holds open, alone.
    holding.release()
    expect((await restoring).isOk()).toBe(true)
    expect(b.session.space()?.tenants()).toEqual(['acme'])
    await settle()
    expect(b.tenantsDeleted()).toEqual([])
    expect(a.tenantsDeleted()).toEqual([])
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme', 'globex'])
    await expect(b.session.close()).resolves.toBeUndefined()
  })

  it('sign-out asks before it deletes an inventoried tenant database that did not open, and deletes it once told to forget', async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const booted = await world({ storage, online: false, refusedTenants: ['globex'] })
    const { session, contexts, tenantsDestroyed, tenantsDeleted, driveClock, failures } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

    // Globex's database does not open: it is no open space, yet the device may hold it. Both open
    // at once, and globex's refusal comes before acme's database is open.
    contexts()[0]?.onMemberships([acme, globex])
    await vi.waitFor(() => expect(failures.map(({ code }) => code)).toEqual(['data:OPEN_FAILED']))
    failures.splice(0)
    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['acme']))
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme', 'globex'])

    // Globex's changes, if it holds any, cannot be read: the sign-out asks and deletes nothing.
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(tenantsDestroyed()).toEqual([])
    expect(tenantsDeleted()).toEqual([])

    expect((await driveClock(session.signOut({ forgetUnsent: true })))._unsafeUnwrap()).toBe(
      'signed-out',
    )
    expect(tenantsDestroyed()).toEqual(['acme'])
    expect(tenantsDeleted()).toEqual(['globex'])
    expect(storage.get(TENANT_DATABASES_KEY)).toBeUndefined()
  })

  it('asks before an online sign-out while an inventoried tenant database did not open, without asking the gateway', async () => {
    const storage = memoryStorage()

    signedIn(storage, annIn([acme, globex]))

    const booted = await world({
      storage,
      online: true,
      memberships: [acme, globex],
      refusedTenants: ['globex'],
    })
    const { session, stub, tenantsDestroyed, tenantsDeleted, driveClock, failures } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))
    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['acme']))

    // Everything acme holds is sent, yet the gateway would revoke the device while globex's
    // changes, if any, stay unreadable on it: the sign-out asks first.
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('needs-confirmation')
    expect(stub.signOuts()).toBe(0)
    expect(tenantsDestroyed()).toEqual([])
    expect(tenantsDeleted()).toEqual([])
    expect(session.current()?.id).toBe(ann.identity.id)
    expect(new Set(failures.splice(0).map(({ code }) => code))).toEqual(
      new Set(['data:OPEN_FAILED']),
    )
  })

  it('keeps the chosen organisation when the one picked did not open on this device', async () => {
    const storage = memoryStorage()
    const kept = signedIn(storage, annIn([acme, globex]))

    const booted = await world({ storage, online: false, refusedTenants: ['globex'] })
    const { session, failures } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(session.space()?.tenants()).toEqual(['acme']))
    session.selectTenant('acme')
    session.selectTenant('globex')

    // Globex is unavailable here: acme stays current, and stays the choice the next start opens with.
    expect(session.currentTenant()?.tenant.key).toBe('acme')
    expect(savedTenant(storage, kept.signIn)).toBe('acme')
    expect(failures.splice(0).map(({ code }) => code)).toEqual(['data:OPEN_FAILED'])
  })

  it('the sign-in page keeps nothing of the memberships after sign-out', async () => {
    const { session, storage, driveClock } = await bootSession({ saved: annIn([acme, globex]) })
    const kept = signInOf(storage, ann.identity.id)
    let heard = 0

    session.selectTenant('globex')
    session.subscribeMemberships(() => {
      heard += 1
    })

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(session.memberships()).toEqual([])
    expect(session.currentTenant()).toBeUndefined()
    expect(storage.get(membershipsKeyOf(kept.signIn))).toBeUndefined()
    expect(savedTenant(storage, kept.signIn)).toBeUndefined()
    expect(heard).toBeGreaterThan(0)
  })

  it("a watch through the session's runner follows the organisation selected", async () => {
    const { session } = await bootSession({ saved: annIn([acme, globex]) })
    const trees: string[][] = []
    const write = (text: string) =>
      session.writePath.run(createNote, {
        id: noteIdFactory.create(),
        author: ann.identity.id,
        text,
      })

    expect((await write('At Acme')).isOk()).toBe(true)
    session.selectTenant('globex')
    expect((await write('At Globex')).isOk()).toBe(true)
    session.selectTenant('acme')

    const stop = session.runner.watch(organisationShape, {}, (tree) =>
      trees.push(tree.map(({ text }) => text)),
    )

    await vi.waitFor(() => expect(trees.at(-1)).toEqual(['At Acme']))
    session.selectTenant('globex')
    await vi.waitFor(() => expect(trees.at(-1)).toEqual(['At Globex']))
    stop()
  })
})

describe('SessionService devices', () => {
  it('names this device at a verification and a sign-in, the id it keeps and its label, and at a sign-up none', async () => {
    const auth = fakeGatewayAuth()
    const { session, storage } = await world({ auth })

    expect((await session.signUp(annSignUp)).isOk()).toBe(true)

    const link = auth.linkFor(annSignUp.email)

    expect((await session.verifyEmail(link)).isOk()).toBe(true)
    expect((await session.signIn(annSignUp)).isOk()).toBe(true)

    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')
    const device = { id, label: TEST_DEVICE_LABEL }

    expect(auth.requests).toEqual([
      { kind: 'sign-up', email: annSignUp.email, name: annSignUp.name, locale: 'en' },
      { kind: 'verify', token: link, device },
      { kind: 'sign-in', email: annSignUp.email, device },
    ])
  })

  it('names this device in its channel: the gateway closes the channels of this device only', async () => {
    const { session, gateway, storage, contexts } = await bootSession({ saved: ann, online: true })
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    expect(contexts().map((context) => context.device)).toEqual([id])

    // Another device of the identity signed out: this one stays signed in.
    gateway.closeChannels(ann.identity.id, 'another-device', CLOSE.revoked)
    await settle()
    expect(session.current()?.id).toBe(ann.identity.id)

    gateway.closeChannels(ann.identity.id, id, CLOSE.revoked)
    await vi.waitFor(() => expect(session.current()).toBeUndefined())
  })

  it('signs out when another device signed it out: the token goes, the database goes with nothing unsent, and the sign-in page says why', async () => {
    const { session, gateway, storage, destroyed } = await bootSession({ saved: ann, online: true })
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    gateway.closeChannels(ann.identity.id, id, CLOSE.revoked)

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(savedToken(storage)).toBeUndefined()
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
    expect(session.notice()).toBe('signed-out-elsewhere')
    // The token is dead, so nothing waits to be signed out; the browser keeps its id.
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
    expect(storage.get('perch.device.id')).toBe(id)
    expect(gateway.signOuts()).toBe(0)
  })

  it('keeps the database with unsent changes when another device signed it out, and asks to sign in again', async () => {
    const { session, gateway, storage, destroyed, writeOffline } = await bootSession({
      saved: ann,
      online: false,
    })

    await writeOffline()
    gateway.endWith('revoked')

    await vi.waitFor(() => expect(session.current()).toBeUndefined())
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('resend-after-sign-in')
    expect(storage.get('perch.session.pending-revoke')).toBeUndefined()
    await settle()
    expect(destroyed()).toEqual([])
  })

  it('keeps the token it could not sign out offline, and sends it at the next start online, forgetting it once signed out', async () => {
    const { session, storage, driveClock } = await bootSession({ saved: ann, online: false })
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(savedSession(storage)).toBeUndefined()
    expect(pendingRevokes(storage)).toEqual([{ token: ann.token, device: id }])

    // Still offline at the next start: the token waits.
    const offline = fakeGatewayAuth()
    const later = await world({ storage, online: false, auth: offline })

    expect((await later.session.restore())._unsafeUnwrap()).toBeUndefined()
    await settle()
    expect(offline.requests).toEqual([])
    expect(pendingRevokes(storage)).toEqual([{ token: ann.token, device: id }])

    // Online, the next start sends it with this device's id, and forgets it once revoked.
    const auth = fakeGatewayAuth()
    const next = await world({ storage, online: true, auth })

    expect((await next.session.restore())._unsafeUnwrap()).toBeUndefined()
    await vi.waitFor(() => expect(pendingRevokes(storage)).toEqual([]))
    expect(auth.requests).toEqual([{ kind: 'sign-out', token: ann.token, device: id }])
  })

  it('keeps the token to sign out when a frozen tab keeps the database during an offline sign-out', async () => {
    const locks = new FakeLocks()
    const storage = memoryStorage()

    signedIn(storage, ann)

    const booted = await world({ storage, locks, online: false })
    const { session, destroyed, driveClock } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'down' }))

    // A frozen tab holds a write it never finishes.
    void locks.request(
      writeLockName(ann.identity.id),
      { mode: 'shared' },
      () => new Promise(() => {}),
    )

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')
    expect(destroyed()).toEqual([])
    expect(session.notice()).toBe('resend-after-sign-in')
    expect(savedSession(storage)).toBeUndefined()
    expect(pendingRevokes(storage)).toEqual([
      { token: ann.token, device: storage.get('perch.device.id') },
    ])
  })

  it('sends the token it could not sign out at once when the browser is online: changes the gateway refused given up', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    signedIn(storage, ann)

    const booted = await world({ storage, auth, online: true, wrap: refuseResets })
    const { session, stub, failures } = booted

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(booted.states.at(-1)).toEqual({ leader: true, channel: 'up' }))

    stub.rejectEverything()
    expect((await session.writePath.run(createProfile, aProfile())).isOk()).toBe(true)
    await vi.waitFor(() =>
      expect(failures.map((failure) => failure.code)).toContain('data:SYNC_STOPPED'),
    )
    failures.splice(0)

    // The engine does not ask the gateway with changes it cannot send; the token goes on its own.
    expect((await session.signOut({ forgetUnsent: true }))._unsafeUnwrap()).toBe('signed-out')
    expect(stub.signOuts()).toBe(0)
    await vi.waitFor(() => expect(pendingRevokes(storage)).toEqual([]))
    expect(auth.requests).toEqual([
      { kind: 'sign-out', token: ann.token, device: storage.get('perch.device.id') },
    ])
  })

  it('keeps the token to sign out when it signs out giving unsent changes up', async () => {
    const { session, storage, writeOffline, driveClock } = await bootSession({
      saved: ann,
      online: false,
    })

    await writeOffline()

    expect((await driveClock(session.signOut({ forgetUnsent: true })))._unsafeUnwrap()).toBe(
      'signed-out',
    )
    expect(pendingRevokes(storage)).toEqual([
      { token: ann.token, device: storage.get('perch.device.id') },
    ])
  })

  it('forgets the token to sign out when the gateway no longer takes it (401): the token is dead', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    addPendingRevoke(storage, annLeft)
    auth.answerSignOut(() =>
      errAsync(dataError('data:AUTH_FAILED', 'the gateway no longer takes the token')),
    )

    const { session } = await world({ storage, auth })

    expect((await session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(pendingRevokes(storage)).toEqual([]))
    expect(auth.requests.map((request) => request.kind)).toEqual(['sign-out'])
  })

  it('keeps the token to sign out when the gateway cannot be reached or fails, and reports a failure', async () => {
    const storage = memoryStorage()
    const unreachable = fakeGatewayAuth()

    addPendingRevoke(storage, annLeft)
    unreachable.answerSignOut(() =>
      errAsync(dataError('data:OFFLINE', 'could not reach the gateway')),
    )

    const first = await world({ storage, auth: unreachable })

    expect((await first.session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(unreachable.requests).toHaveLength(1))
    await settle()
    expect(pendingRevokes(storage)).toEqual([annLeft])
    expect(first.failures).toEqual([])

    const failing = fakeGatewayAuth()
    const failure = dataError('data:WRITE_FAILED', 'the gateway could not sign the token out (500)')

    failing.answerSignOut(() => errAsync(failure))

    const second = await world({ storage, auth: failing })

    expect((await second.session.restore()).isOk()).toBe(true)
    await vi.waitFor(() => expect(second.failures).toEqual([failure]))
    expect(pendingRevokes(storage)).toEqual([annLeft])
    second.failures.splice(0)
  })

  it("keeps each account's token to sign out: another account's offline sign-out does not overwrite it, and each goes on its own answer", async () => {
    const auth = fakeGatewayAuth()
    const { session, storage, failures, driveClock } = await world({ auth, online: false })
    const failed = dataError('data:WRITE_FAILED', 'the gateway could not sign the token out (500)')

    // Ann signs out offline: her token waits.
    expect((await signUpVerified(session, auth, annSignUp)).isOk()).toBe(true)

    const annToken = savedToken(storage) ?? expect.unreachable("Ann's token")

    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    // Sent before Bob signs in, it fails (500): it stays, and Bob signs in all the same.
    auth.answerSignOut(() => errAsync(failed))

    expect((await signUpVerified(session, auth, bobSignUp)).isOk()).toBe(true)
    expect(failures.splice(0)).toEqual([failed])

    const bobToken = savedToken(storage) ?? expect.unreachable("Bob's token")

    // Bob signs out offline: his token joins Ann's, which is not lost.
    expect((await driveClock(session.signOut()))._unsafeUnwrap()).toBe('signed-out')

    const device = storage.get('perch.device.id')

    expect(pendingRevokes(storage)).toEqual([
      { token: annToken, device },
      { token: bobToken, device },
    ])

    // Ann's token is signed out and Bob's cannot reach the gateway: only Bob's waits.
    auth.answerSignOut((token) =>
      token === annToken
        ? okAsync(undefined)
        : errAsync(dataError('data:OFFLINE', 'could not reach the gateway')),
    )

    expect((await session.signIn(annSignUp)).isOk()).toBe(true)
    expect(pendingRevokes(storage)).toEqual([{ token: bobToken, device }])
  })

  it('signs this device out at once when the gateway signed every device out, with no sync channel to hear it: the token goes, the sign-in page says why, a 4001 afterwards changes nothing', async () => {
    const { session, storage, destroyed, contexts } = await bootSession({
      saved: ann,
      online: false,
    })
    const signOutHere = session.signingOutEverywhere()

    // The gateway answered: every device of the identity is signed out, this one included.
    expect((await signOutHere()).isOk()).toBe(true)
    expect(session.current()).toBeUndefined()
    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
    expect(session.notice()).toBe('signed-out-elsewhere')
    expect(destroyed()).toEqual([ann.identity.id])
    // Its token died with every session of the identity: nothing waits to be signed out.
    expect(pendingRevokes(storage)).toEqual([])

    // The channel's own 4001, should it come after all, finds nothing left to sign out.
    session.clearNotice()

    for (const context of contexts()) {
      context.onEnded('revoked')
    }

    await settle()

    expect(session.notice()).toBeUndefined()
    expect(destroyed()).toEqual([ann.identity.id])
  })

  it('keeps the database with unsent changes when the gateway signed every device out, and asks to sign in again', async () => {
    const { session, storage, destroyed, writeOffline } = await bootSession({
      saved: ann,
      online: false,
    })

    await writeOffline()

    const signOutHere = session.signingOutEverywhere()

    expect((await signOutHere()).isOk()).toBe(true)
    expect(session.current()).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(session.notice()).toBe('resend-after-sign-in')
    expect(pendingRevokes(storage)).toEqual([])
    await settle()
    expect(destroyed()).toEqual([])
  })

  it('finds nothing left to sign out when the 4001 came first', async () => {
    const { session, gateway, storage, destroyed } = await bootSession({ saved: ann, online: true })
    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')
    const signOutHere = session.signingOutEverywhere()

    gateway.closeChannels(ann.identity.id, id, CLOSE.revoked)
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    session.clearNotice()

    expect((await signOutHere()).isOk()).toBe(true)
    expect(session.notice()).toBeUndefined()
    expect(destroyed()).toEqual([ann.identity.id])
  })

  it('signs out only the session that asked when the answer comes late: Bob, signed in after the 4001 signed Ann out, keeps his token and his database', async () => {
    const auth = fakeGatewayAuth()
    const { session, storage, destroyed, contexts } = await world({ online: false, auth })

    expect((await signUpVerified(session, auth, annSignUp)).isOk()).toBe(true)

    const annId = session.current()?.id ?? expect.unreachable('Ann signed in')
    // Ann asks the gateway to sign every device out; its answer is held up on the way.
    const signOutAnn = session.signingOutEverywhere()

    // Her channel's 4001 signs her out first, and Bob signs in on the same browser.
    for (const context of contexts()) {
      context.onEnded('revoked')
    }

    await vi.waitFor(() => expect(destroyed()).toEqual([annId]))
    expect((await signUpVerified(session, auth, bobSignUp)).isOk()).toBe(true)

    const bob = session.current() ?? expect.unreachable('Bob signed in')
    const bobToken = savedToken(storage) ?? expect.unreachable("Bob's token")

    // Ann's answer comes at last: it signs nobody out.
    expect((await signOutAnn()).isOk()).toBe(true)
    await settle()
    expect(session.current()).toEqual(bob)
    expect(savedToken(storage)).toBe(bobToken)
    expect(destroyed()).toEqual([annId])
  })

  it('leaves the same account alone when it signed in again before the late answer: its new session did not ask', async () => {
    const auth = fakeGatewayAuth()
    const { session, storage, destroyed, contexts } = await world({ online: false, auth })

    expect((await signUpVerified(session, auth, annSignUp)).isOk()).toBe(true)

    const annId = session.current()?.id ?? expect.unreachable('Ann signed in')
    const signOutFirst = session.signingOutEverywhere()

    for (const context of contexts()) {
      context.onEnded('revoked')
    }

    await vi.waitFor(() => expect(destroyed()).toEqual([annId]))
    expect((await session.signIn(annSignUp)).isOk()).toBe(true)

    const token = savedToken(storage) ?? expect.unreachable("Ann's new token")

    expect((await signOutFirst()).isOk()).toBe(true)
    await settle()
    expect(session.current()?.id).toBe(annId)
    expect(savedToken(storage)).toBe(token)
    expect(destroyed()).toEqual([annId])
  })

  it('signs out a token left to sign out before it signs in again, so the sign-in does not outlive it', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()

    expect((await verifiedElsewhere(auth, annSignUp)).isOk()).toBe(true)
    auth.requests.splice(0)
    addPendingRevoke(storage, annLeft)

    // Offline at the start, the token waits; the sign-in sends it first.
    const { session } = await world({ storage, auth, online: false })

    expect((await session.restore()).isOk()).toBe(true)
    await settle()
    expect(auth.requests).toEqual([])

    expect((await session.signIn(annSignUp)).isOk()).toBe(true)
    expect(auth.requests.map((request) => request.kind)).toEqual(['sign-out', 'sign-in'])
    expect(pendingRevokes(storage)).toEqual([])
  })
})
