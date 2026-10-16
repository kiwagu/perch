import { describe, expect, it } from 'vitest'

import {
  createProfile,
  deleteProfile,
  identityId,
  profileId,
  profileSchema,
  updateBio,
  updateName,
} from './__fixtures__/profile'
import { RegionDoc } from './region-doc'
import { LoroWritePath } from './write-path'

const ann = { id: profileId, identity: identityId, name: 'Ann', email: 'ann@example.test' }
const key = `profile/${profileId}`

describe('LoroWritePath', () => {
  it('creates a record under records/<table>/<key> and stores references as table:key', async () => {
    const region = RegionDoc.inMemory('private')
    const written = await new LoroWritePath(region, profileSchema).run(createProfile, ann)

    expect(written.isOk()).toBe(true)
    expect(region.records().get(key)).toBeDefined()
    expect(region.recordJson(key)).toEqual({
      identity: `identity:${identityId}`,
      name: 'Ann',
      email: 'ann@example.test',
    })
  })

  it('applies a set plan to an existing record', async () => {
    const region = RegionDoc.inMemory('private')
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(updateName, { id: profileId, name: 'Anna' })).isOk()).toBe(true)
    expect(region.recordJson(key)).toMatchObject({ name: 'Anna' })
  })

  it('merges concurrent edits of a text field from two devices', async () => {
    const a = RegionDoc.inMemory('private')
    const b = RegionDoc.inMemory('private')

    expect((await new LoroWritePath(a, profileSchema).run(createProfile, ann)).isOk()).toBe(true)
    b.doc.import(a.doc.export({ mode: 'update' }))
    expect(
      (
        await new LoroWritePath(a, profileSchema).run(updateBio, {
          id: profileId,
          bio: 'Hello world',
        })
      ).isOk(),
    ).toBe(true)
    expect(
      (
        await new LoroWritePath(b, profileSchema).run(updateBio, {
          id: profileId,
          bio: 'Hello there',
        })
      ).isOk(),
    ).toBe(true)

    const fromA = a.doc.export({ mode: 'update', from: b.doc.version() })
    const fromB = b.doc.export({ mode: 'update', from: a.doc.version() })

    a.doc.import(fromB)
    b.doc.import(fromA)

    expect(a.recordJson(key)).toEqual(b.recordJson(key))
    expect(String(a.recordJson(key)?.['bio'])).toContain('Hello')
  })

  it('deletes a record', async () => {
    const region = RegionDoc.inMemory('private')
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(deleteProfile, { id: profileId })).isOk()).toBe(true)
    expect(region.records().get(key)).toBeUndefined()
  })

  it('refuses a change to a record that does not exist, without writing anything', async () => {
    const region = RegionDoc.inMemory('private')
    const result = await new LoroWritePath(region, profileSchema).run(updateName, {
      id: profileId,
      name: 'X',
    })

    expect(result._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(region.records().size).toBe(0)
  })

  it('refuses to create a record that exists, keeping its later edits and its history', async () => {
    const region = RegionDoc.inMemory('private')
    const path = new LoroWritePath(region, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(updateBio, { id: profileId, bio: 'Hello' })).isOk()).toBe(true)

    const version = region.doc.version().encode()
    const retried = await path.run(createProfile, { ...ann, name: 'Ann again' })

    expect(retried._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(region.recordJson(key)).toMatchObject({ name: 'Ann', bio: 'Hello' })
    expect(region.doc.version().encode()).toEqual(version)
  })

  it('refuses a command meant for another region', async () => {
    const region = RegionDoc.inMemory('public')
    const result = await new LoroWritePath(region, profileSchema).run(createProfile, ann)

    expect(result._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })

  it('records the author in the commit message', async () => {
    const region = RegionDoc.inMemory('private')
    const messages: unknown[] = []

    region.doc.subscribePreCommit((event) => {
      messages.push(event.changeMeta.message)
    })

    const written = await new LoroWritePath(region, profileSchema).run(createProfile, ann, {
      actorId: identityId,
      correlationId: 'cor_1',
    })

    expect(written.isOk()).toBe(true)
    expect(JSON.parse(String(messages[0]))).toEqual({
      actor: identityId,
      command: 'user.profile.createProfile',
      correlationId: 'cor_1',
    })
  })
})
