import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type DataError, type LocalDb, ShapeRunner } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { profileIdFactory } from '@workspace/ids'

import { replicaSchema } from '../replica.schema.gen'

import { createProfile, profileById } from './__fixtures__/profile'
import { SessionService } from './session'
import { memoryStorage } from './storage'

const ann = { email: 'ann@example.test', password: 'secret-ann', name: 'Ann' }

let local: LocalDb
let failures: DataError[]

let opened: SessionService[]

const session = (storage = memoryStorage(), database: LocalDb = local) => {
  const service = new SessionService(database, {
    access: 'user',
    namespace: 'app',
    database: 'app',
    schema: replicaSchema,
    storage,
    onError: (error) => failures.push(error),
  })

  opened.push(service)

  return service
}

/**
 * The test database, with region loads held while `hold()` is in force, so a
 * region open stays in flight until `release()`.
 */
function holdingRegionLoads(database: LocalDb) {
  let gate: Promise<void> | undefined
  let open = () => {}
  const state = { waiting: 0 }
  const local = interceptQueries(database, async (text) => {
    if (gate && text.includes('FROM _replica_snapshot')) {
      state.waiting++
      await gate
    }
  })

  return {
    local,
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

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  failures = []
  opened = []
})

afterEach(async () => {
  await Promise.all(opened.map((service) => service.close()))
  expect(failures).toEqual([])
  await local.close()
})

describe('SessionService', () => {
  it('opens the private region of the user who signs up, so commands write and project', async () => {
    const service = session()
    const user = (await service.signUp(ann))._unsafeUnwrap()
    const id = profileIdFactory.create()

    expect(service.current()).toEqual(user)
    expect(
      (
        await service.writePath.run(createProfile, {
          id,
          user: user.id,
          name: 'Ann',
          email: ann.email,
        })
      ).isOk(),
    ).toBe(true)

    expect((await service.flush()).isOk()).toBe(true)

    expect((await new ShapeRunner(local).read(profileById, { id }))._unsafeUnwrap()).toMatchObject({
      name: 'Ann',
    })
  })

  it('refuses writes when nobody is signed in', async () => {
    const service = session()
    const written = await service.writePath.run(createProfile, {
      id: profileIdFactory.create(),
      user: 'usr_0000000000000000.01m52pexcp',
      name: 'X',
      email: 'x@example.test',
    })

    expect(written._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })

  it('closes the region on sign-out', async () => {
    const service = session()

    expect((await service.signUp(ann)).isOk()).toBe(true)
    expect((await service.signOut()).isOk()).toBe(true)
    expect(service.current()).toBeUndefined()
    expect(
      (
        await service.writePath.run(createProfile, {
          id: profileIdFactory.create(),
          user: 'usr_x',
          name: 'X',
          email: 'x',
        })
      ).isErr(),
    ).toBe(true)
  })

  it('restores the session and the region document after a reload', async () => {
    const storage = memoryStorage()
    const first = session(storage)
    const user = (await first.signUp(ann))._unsafeUnwrap()
    const id = profileIdFactory.create()

    expect(
      (
        await first.writePath.run(createProfile, {
          id,
          user: user.id,
          name: 'Ann',
          email: ann.email,
        })
      ).isOk(),
    ).toBe(true)
    expect((await first.flush()).isOk()).toBe(true)

    const second = session(storage)

    expect((await second.restore())._unsafeUnwrap()).toEqual(user)
    expect(second.region()?.recordJson(`profile/${id}`)).toMatchObject({ name: 'Ann' })
  })

  it('keeps the renewed refresh key, so every later reload resumes too', async () => {
    const storage = memoryStorage()
    const user = (await session(storage).signUp(ann))._unsafeUnwrap()
    const spent = storage.get('perch.session.refresh')

    expect(spent).toMatch(/\S/)
    expect((await session(storage).restore())._unsafeUnwrap()).toEqual(user)
    expect(storage.get('perch.session.refresh')).not.toBe(spent)
    expect((await session(storage).restore())._unsafeUnwrap()).toEqual(user)
  })

  it('forgets the keys on sign-out', async () => {
    const storage = memoryStorage()
    const service = session(storage)

    expect((await service.signUp(ann)).isOk()).toBe(true)
    expect((await service.signOut()).isOk()).toBe(true)
    expect(storage.get('perch.session.token')).toBeUndefined()
    expect(storage.get('perch.session.refresh')).toBeUndefined()
    expect((await session(storage).restore())._unsafeUnwrap()).toBeUndefined()
  })

  it('signs out locally even when the database cannot end the session', async () => {
    const service = session()
    const seen: Array<string | undefined> = []

    expect((await service.signUp(ann)).isOk()).toBe(true)
    service.subscribe((user) => seen.push(user?.email))
    await local.close()

    expect((await service.signOut()).isErr()).toBe(true)
    expect(service.current()).toBeUndefined()
    expect(service.region()).toBeUndefined()
    expect(seen).toEqual([undefined])
  })

  it('takes a sign-out made during a sign-in after it, leaving the device signed out', async () => {
    const holding = holdingRegionLoads(local)
    const service = session(memoryStorage(), holding.local)

    expect((await service.signUp(ann)).isOk()).toBe(true)
    expect((await service.signOut()).isOk()).toBe(true)

    holding.hold()

    const signingIn = service.signIn(ann)

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    const signingOut = service.signOut()

    holding.release()

    expect((await signingIn).isOk()).toBe(true)
    expect((await signingOut).isOk()).toBe(true)
    expect(service.current()).toBeUndefined()
    expect(service.region()).toBeUndefined()
  })

  it('runs overlapping sign-ins one after the other, so the later one owns the session and its keys', async () => {
    const storage = memoryStorage()
    const holding = holdingRegionLoads(local)
    const service = session(storage, holding.local)
    const bob = { email: 'bob@example.test', password: 'secret-bob', name: 'Bob' }

    expect((await service.signUp(bob)).isOk()).toBe(true)
    expect((await service.signUp(ann)).isOk()).toBe(true)

    holding.hold()

    const first = service.signIn(bob)

    await vi.waitFor(() => expect(holding.state.waiting).toBe(1))

    const bobsKey = storage.get('perch.session.refresh')
    const second = service.signIn(ann)

    // Ann's sign-in waits for Bob's: it has not touched the shared session or the keys.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(storage.get('perch.session.refresh')).toBe(bobsKey)
    holding.release()

    expect((await first)._unsafeUnwrap().email).toBe(bob.email)
    expect((await second)._unsafeUnwrap().email).toBe(ann.email)
    expect(service.current()?.email).toBe(ann.email)
    expect(service.region()?.ref.id).toBe(`user:${service.current()?.id}`)
    expect((await session(storage).restore())._unsafeUnwrap()?.email).toBe(ann.email)
  })

  it('tells subscribers when the signed-in user changes', async () => {
    const service = session()
    const seen: Array<string | undefined> = []

    service.subscribe((user) => seen.push(user?.email))
    expect((await service.signUp(ann)).isOk()).toBe(true)
    expect((await service.signOut()).isOk()).toBe(true)

    expect(seen).toEqual([ann.email, undefined])
  })
})
