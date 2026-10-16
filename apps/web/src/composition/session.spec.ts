import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type DataError, type LocalDb, ShapeRunner } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { profileIdFactory } from '@workspace/ids'

import { replicaSchema } from '../replica.schema.gen'

import { createProfile, profileById } from './__fixtures__/profile'
import { SessionService } from './session'
import { memoryStorage } from './storage'

const ann = { email: 'ann@example.test', password: 'secret-ann', name: 'Ann' }

let local: LocalDb
let failures: DataError[]

const session = (storage = memoryStorage()) =>
  new SessionService(local, {
    access: 'user',
    namespace: 'app',
    database: 'app',
    schema: replicaSchema,
    storage,
    onError: (error) => failures.push(error),
  })

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  failures = []
})

afterEach(async () => {
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

  it('tells subscribers when the signed-in user changes', async () => {
    const service = session()
    const seen: Array<string | undefined> = []

    service.subscribe((user) => seen.push(user?.email))
    expect((await service.signUp(ann)).isOk()).toBe(true)
    expect((await service.signOut()).isOk()).toBe(true)

    expect(seen).toEqual([ann.email, undefined])
  })
})
