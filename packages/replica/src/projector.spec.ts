import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type LocalDb, onChange, ShapeRunner, type TableChange } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import {
  createProfile,
  deleteProfile,
  profileById,
  profileId,
  profileSchema,
  updateBio,
  userId,
} from './__fixtures__/profile'
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
    await projector.flush()

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
    await projector.flush()

    expect(await readProfile()).toMatchObject({ bio: 'Hello' })

    expect((await path.run(deleteProfile, { id: profileId })).isOk()).toBe(true)
    await projector.flush()

    expect(await readProfile()).toBeUndefined()
  })

  it('announces the tables it wrote', async () => {
    const seen: TableChange[] = []
    const unsubscribe = onChange(local, (change) => seen.push(change))

    expect((await new LoroWritePath(region, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    await projector.flush()
    unsubscribe()

    expect(seen).toEqual([{ tables: ['profile'], origin: 'projector' }])
  })

  it('projects updates imported from another device', async () => {
    const other = RegionDoc.inMemory('private')

    expect((await new LoroWritePath(other, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    region.doc.import(other.doc.export({ mode: 'update' }))
    await projector.flush()

    expect(await readProfile()).toMatchObject({ name: 'Ann' })
  })

  it('reports a projection the schema refuses', async () => {
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, { ...ann, name: '' })).isOk()).toBe(true)
    await projector.flush()

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

    await late.flush()
    stopLate()

    expect(await readProfile()).toMatchObject({ name: 'Ann' })
  })
})
