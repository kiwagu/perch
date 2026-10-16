import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import acceptAppends from './__fixtures__/accept-appends.surql'
import { createProfile, profileId, profileSchema, updateName, userId } from './__fixtures__/profile'
import refuseAppends from './__fixtures__/refuse-appends.surql'
import countsStatement from './__fixtures__/replica-counts.surql'
import { RegionDoc, type RegionRef } from './region-doc'
import { LoroWritePath } from './write-path'

const ref: RegionRef = { kind: 'private', id: `user:${userId}` }
const ann = { id: profileId, user: userId, name: 'Ann', email: 'ann@example.test' }
const key = `profile/${profileId}`

let local: LocalDb

const open = async () => (await RegionDoc.open(local, ref))._unsafeUnwrap()

async function counts(): Promise<{ snapshots: number; updates: number; outbox: number }> {
  const [snapshots, updates, outbox] = (await local.db.query(countsStatement, {
    region: ref.id,
  })) as number[][]

  return { snapshots: snapshots?.[0] ?? 0, updates: updates?.[0] ?? 0, outbox: outbox?.[0] ?? 0 }
}

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
})

afterEach(async () => {
  await local.close()
})

describe('RegionDoc persistence', () => {
  it('acknowledges a command only once it is durable, and retries a failed update before later ones', async () => {
    const region = await open()
    const path = new LoroWritePath(region, profileSchema)

    await local.db.query(refuseAppends)

    expect((await path.run(createProfile, ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect((await region.flush()).isErr()).toBe(true)
    expect(await counts()).toEqual({ snapshots: 0, updates: 0, outbox: 0 })

    await local.db.query(acceptAppends)

    expect((await path.run(updateName, { id: profileId, name: 'Anna' })).isOk()).toBe(true)
    expect(region.persistedSeq()).toBe(2)
    region.close()

    const reopened = await open()

    expect(reopened.recordJson(key)).toMatchObject({ name: 'Anna', email: 'ann@example.test' })
    expect(await counts()).toEqual({ snapshots: 0, updates: 2, outbox: 2 })
  })

  it('restores the document from the local database', async () => {
    const first = await open()
    const path = new LoroWritePath(first, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(updateName, { id: profileId, name: 'Anna' })).isOk()).toBe(true)
    expect((await first.flush()).isOk()).toBe(true)
    first.close()

    const reopened = await open()

    expect(reopened.recordJson(key)).toMatchObject({ name: 'Anna', email: 'ann@example.test' })
    expect(await counts()).toEqual({ snapshots: 0, updates: 2, outbox: 2 })
  })

  it('has written the update by the time a command succeeds', async () => {
    const region = await open()

    expect((await new LoroWritePath(region, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    expect(region.persistedSeq()).toBe(1)
    expect(await counts()).toEqual({ snapshots: 0, updates: 1, outbox: 1 })
  })

  it('compacts the log into one full snapshot and keeps numbering after a reopen', async () => {
    const first = await open()
    const path = new LoroWritePath(first, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(updateName, { id: profileId, name: 'Anna' })).isOk()).toBe(true)
    expect((await first.compact()).isOk()).toBe(true)
    expect(await counts()).toEqual({ snapshots: 1, updates: 0, outbox: 2 })
    first.close()

    const reopened = await open()

    expect(reopened.doc.isShallow()).toBe(false)
    expect(reopened.recordJson(key)).toMatchObject({ name: 'Anna' })
    expect(
      (
        await new LoroWritePath(reopened, profileSchema).run(updateName, {
          id: profileId,
          name: 'Ann B',
        })
      ).isOk(),
    ).toBe(true)
    expect((await reopened.flush()).isOk()).toBe(true)

    expect(reopened.persistedSeq()).toBe(3)
    expect(await counts()).toEqual({ snapshots: 1, updates: 1, outbox: 3 })
  })
})
