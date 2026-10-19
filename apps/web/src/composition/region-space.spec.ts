import { okAsync } from 'neverthrow'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, profileIdFactory } from '@workspace/ids'
import { privateRegionId, RegionDoc, type RegionRef, replaceRegionDoc } from '@workspace/replica'
import { interceptRegionResets } from '@workspace/replica/testing'

import { createProfile, profileById } from './__fixtures__/profile'
import { openRegionSpace, type RegionSpace } from './region-space'

const identity = identityIdFactory.create()
const ref: RegionRef = { kind: 'private', id: privateRegionId(identity) }

let local: LocalDb

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
})

afterEach(async () => {
  await local.close()
})

/** A region space over `database`, which it never closes: the test closes the database. */
async function openSpace(database: LocalDb = local): Promise<RegionSpace> {
  return (
    await openRegionSpace({
      openLocal: () => okAsync({ ...database, close: async () => {}, destroy: async () => {} }),
      ref,
      schema: replicaSchema,
      onError: (error) => {
        throw new Error(`${error.code} ${error.message}`)
      },
    })
  )._unsafeUnwrap()
}

/** A profile of `owner`: an identity has one profile, so a second one beside it names another. */
const profile = (name: string, owner: string = identity) => ({
  id: profileIdFactory.create(),
  identity: owner,
  name,
  email: 'ann@example.test',
})

/** The name the database holds for profile `id`, once the space's writes are projected. */
async function nameOf(space: RegionSpace, id: string): Promise<string | undefined> {
  ;(await space.flush())._unsafeUnwrap()

  return (await space.runner.read(profileById, { id }))._unsafeUnwrap()?.name
}

describe('region space replacement', () => {
  it('reopen replaces the document with what the database holds and re-projects it', async () => {
    const space = await openSpace()
    const written = profile('Ann')

    expect((await space.writePath.run(createProfile, written)).isOk()).toBe(true)

    // Another tab resets the region.
    const other = (await RegionDoc.open(local, ref))._unsafeUnwrap()

    ;(await replaceRegionDoc(local, other, 'reset'))._unsafeUnwrap()

    const old = space.region
    const next = (await space.replace(old, 'reopen'))._unsafeUnwrap()

    expect(next).not.toBe(old)
    expect(space.region).toBe(next)
    await vi.waitFor(async () => expect(await nameOf(space, written.id)).toBeUndefined())

    const again = profile('Bea')

    expect((await space.writePath.run(createProfile, again)).isOk()).toBe(true)
    expect(await nameOf(space, again.id)).toBe('Bea')
    expect((await space.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })

  it('reset drops the local copy and the projection', async () => {
    const space = await openSpace()
    const written = profile('Ann')

    expect((await space.writePath.run(createProfile, written)).isOk()).toBe(true)
    ;(await space.replace(space.region, 'reset'))._unsafeUnwrap()

    expect((await space.region.outbox(10))._unsafeUnwrap()).toEqual([])
    await vi.waitFor(async () => expect(await nameOf(space, written.id)).toBeUndefined())

    expect((await space.writePath.run(createProfile, profile('Bea'))).isOk()).toBe(true)
    expect((await space.region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })

  it('answers the current document when the one named was replaced already', async () => {
    const space = await openSpace()
    const old = space.region
    const first = (await space.replace(old, 'reset'))._unsafeUnwrap()
    const between = (await RegionDoc.open(local, ref))._unsafeUnwrap()
    const second = (await space.replace(old, 'reset'))._unsafeUnwrap()

    expect(second).toBe(first)
    expect((await between.stale())._unsafeUnwrap()).toBe(false)
  })

  it('refuses writes while it replaces', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const space = await openSpace(interceptRegionResets(local, () => gate))
    const replaced = space.replace(space.region, 'reset')

    await new Promise((resolve) => setTimeout(resolve, 20))

    const refused = await space.writePath.run(createProfile, profile('Ann'))

    expect(refused._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')

    release()
    ;(await replaced)._unsafeUnwrap()

    expect((await space.writePath.run(createProfile, profile('Bea'))).isOk()).toBe(true)
  })

  it('keeps the old document projected and written when the reset fails', async () => {
    const space = await openSpace(
      interceptRegionResets(local, () => {
        throw new Error('the database refuses the reset')
      }),
    )
    const written = profile('Ann')

    expect((await space.writePath.run(createProfile, written)).isOk()).toBe(true)

    const old = space.region

    expect((await space.replace(old, 'reset')).isErr()).toBe(true)
    expect(space.region).toBe(old)
    expect(await nameOf(space, written.id)).toBe('Ann')

    const again = profile('Bea', identityIdFactory.create())

    expect((await space.writePath.run(createProfile, again)).isOk()).toBe(true)
    expect(await nameOf(space, again.id)).toBe('Bea')
  })
})
