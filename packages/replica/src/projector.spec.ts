import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type LocalDb, onChange, ShapeRunner, type TableChange } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'

import acceptProfileDeletes from './__fixtures__/accept-profile-deletes.surql'
import {
  createProfile,
  deleteProfile,
  profileById,
  profileId,
  profileSchema,
  updateBio,
  userId,
} from './__fixtures__/profile'
import refuseProfileDeletes from './__fixtures__/refuse-profile-deletes.surql'
import { Projector } from './projector'
import { RegionDoc } from './region-doc'
import { LoroWritePath } from './write-path'

const ann = { id: profileId, user: userId, name: 'Ann', email: 'ann@example.test' }

let local: LocalDb
let region: RegionDoc
let projector: Projector
let stop: () => void
let failures: string[]

const readProfile = async () =>
  (await new ShapeRunner(local).read(profileById, { id: profileId }))._unsafeUnwrap()

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  failures = []
  region = RegionDoc.inMemory('private')
  projector = new Projector(region, local, profileSchema, {
    onError: (error) => failures.push(error.message),
  })
  stop = projector.start()
})

afterEach(async () => {
  expect(failures).toEqual([])
  stop()
  await local.close()
})

describe('Projector', () => {
  it('materializes a created record in the local database', async () => {
    expect((await new LoroWritePath(region, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    expect((await projector.flush()).isOk()).toBe(true)

    expect(await readProfile()).toEqual({
      id: profileId,
      user: userId,
      name: 'Ann',
      email: 'ann@example.test',
    })
  })

  it('follows edits and deletes', async () => {
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(updateBio, { id: profileId, bio: 'Hello' })).isOk()).toBe(true)
    expect((await projector.flush()).isOk()).toBe(true)

    expect(await readProfile()).toMatchObject({ bio: 'Hello' })

    expect((await path.run(deleteProfile, { id: profileId })).isOk()).toBe(true)
    expect((await projector.flush()).isOk()).toBe(true)

    expect(await readProfile()).toBeUndefined()
  })

  it('announces the tables it wrote', async () => {
    const seen: TableChange[] = []
    const unsubscribe = onChange(local, (change) => seen.push(change))

    expect((await new LoroWritePath(region, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    expect((await projector.flush()).isOk()).toBe(true)
    unsubscribe()

    expect(seen).toEqual([{ tables: ['profile'], origin: 'projector' }])
  })

  it('projects updates imported from another device', async () => {
    const other = RegionDoc.inMemory('private')

    expect((await new LoroWritePath(other, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    region.doc.import(other.doc.export({ mode: 'update' }))
    expect((await projector.flush()).isOk()).toBe(true)

    expect(await readProfile()).toMatchObject({ name: 'Ann' })
  })

  it('reports a projection the schema refuses', async () => {
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, { ...ann, name: '' })).isOk()).toBe(true)
    expect((await projector.flush()).isErr()).toBe(true)

    expect(failures).toEqual([`could not project profile/${profileId}`])
    failures = []
  })

  it('projects records that existed before it started', async () => {
    const earlier = RegionDoc.inMemory('private')

    expect((await new LoroWritePath(earlier, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )

    const late = new Projector(earlier, local, profileSchema, {
      onError: (error) => failures.push(error.message),
    })
    const stopLate = late.start()

    expect((await late.flush()).isOk()).toBe(true)
    stopLate()

    expect(await readProfile()).toMatchObject({ name: 'Ann' })
  })

  it('reports a failed projection on flush and retries it there until it succeeds', async () => {
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await projector.flush()).isOk()).toBe(true)

    await local.db.query(refuseProfileDeletes)

    expect((await path.run(deleteProfile, { id: profileId })).isOk()).toBe(true)
    expect((await projector.flush()).isErr()).toBe(true)
    expect(await readProfile()).toMatchObject({ name: 'Ann' })

    await local.db.query(acceptProfileDeletes)

    expect((await projector.flush()).isOk()).toBe(true)
    expect(await readProfile()).toBeUndefined()
    expect(failures).toEqual([`could not project profile/${profileId}`])
    failures = []
  })

  it('repairs a deletion that failed before a reload, retrying the lookup of what it projected', async () => {
    const ref = { kind: 'private', id: `user:${userId}` } as const
    const before = (await RegionDoc.open(local, ref))._unsafeUnwrap()
    const beforeProjector = new Projector(before, local, profileSchema, {
      onError: (error) => failures.push(error.message),
    })
    const stopBefore = beforeProjector.start()
    const path = new LoroWritePath(before, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await beforeProjector.flush()).isOk()).toBe(true)

    await local.db.query(refuseProfileDeletes)

    expect((await path.run(deleteProfile, { id: profileId })).isOk()).toBe(true)
    expect((await beforeProjector.flush()).isErr()).toBe(true)
    stopBefore()
    before.close()
    failures = []

    await local.db.query(acceptProfileDeletes)

    // After the reload the first lookup of what the region projected fails once.
    let lookups = 0
    const flaky = interceptQueries(local, (text) => {
      if (text.includes('FROM _replica_projected') && lookups++ === 0) {
        throw new Error('the lookup failed once')
      }
    })
    const reopened = (await RegionDoc.open(local, ref))._unsafeUnwrap()
    const reloaded = new Projector(reopened, flaky, profileSchema, {
      onError: (error) => failures.push(error.message),
    })

    stop = reloaded.start()

    expect((await reloaded.flush()).isOk()).toBe(true)
    expect(lookups).toBe(2)
    expect(await readProfile()).toBeUndefined()
    expect(failures).toEqual([`could not read what ${ref.id} projected`])
    failures = []
  })
})
