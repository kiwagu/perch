import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { identityIdFactory, profileIdFactory } from '@workspace/ids'

import { createProfile, profileById } from './__fixtures__/profile'
import { openTestWorld, type TestWorld, type TestWorldOptions } from './__fixtures__/session'
import type { SignedInDevice } from './gateway-auth'
import { memoryStorage, saveDevice } from './storage'

const ann: SignedInDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-ann', refresh: 'refresh-ann' },
}

const annSignUp = { email: 'ann@example.test', password: 'pass-word-1' }

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
    expect(gateway.signOuts()).toBe(0)

    expect((await session.signOut({ forgetUnsent: true }))._unsafeUnwrap()).toBe('signed-out')
    expect(gateway.signOuts()).toBe(1)
    expect(destroyed()).toEqual([ann.identity.id])
  })

  it('forgets the device when the gateway refuses its keys', async () => {
    const { session, gateway, storage, destroyed } = await bootSession({ saved: ann, online: true })

    gateway.endWith('unauthorized')
    await settle()

    expect(session.current()).toBeUndefined()
    await vi.waitFor(() => expect(destroyed()).toEqual([ann.identity.id]))
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(gateway.signOuts()).toBe(0)
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
