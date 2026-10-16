import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import { createProfile, profileId, profileSchema, updateName, userId } from './__fixtures__/profile'
import countsStatement from './__fixtures__/replica-counts.surql'
import { RegionDoc, type RegionRef } from './region-doc'
import { LoroWritePath } from './write-path'

const ref: RegionRef = { kind: 'private', id: `user:${userId}` }
const ann = { id: profileId, user: userId, name: 'Ann', email: 'ann@example.test' }
const key = `profile/${profileId}`

let local: LocalDb
let failures: DataError[]

const open = async () =>
  (await RegionDoc.open(local, ref, { onError: (error) => failures.push(error) }))._unsafeUnwrap()

async function counts(): Promise<{ snapshots: number; updates: number; outbox: number }> {
  const [snapshots, updates, outbox] = (await local.db.query(countsStatement, {
    region: ref.id,
  })) as number[][]

  return { snapshots: snapshots?.[0] ?? 0, updates: updates?.[0] ?? 0, outbox: outbox?.[0] ?? 0 }
}

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
  failures = []
})

afterEach(async () => {
  expect(failures).toEqual([])
  await local.close()
})

describe('RegionDoc persistence', () => {
  it('restores the document from the local database', async () => {
    const first = await open()
    const path = new LoroWritePath(first, profileSchema)

    expect((await path.run(createProfile, ann)).isOk()).toBe(true)
    expect((await path.run(updateName, { id: profileId, name: 'Anna' })).isOk()).toBe(true)
    await first.flush()
    first.close()

    const reopened = await open()

    expect(reopened.recordJson(key)).toMatchObject({ name: 'Anna', email: 'ann@example.test' })
    expect(await counts()).toEqual({ snapshots: 0, updates: 2, outbox: 2 })
  })

  it('moves the durable watermark only after the update is written', async () => {
    const region = await open()

    expect((await new LoroWritePath(region, profileSchema).run(createProfile, ann)).isOk()).toBe(
      true,
    )
    expect(region.persistedSeq()).toBe(0)

    await region.flush()

    expect(region.persistedSeq()).toBe(1)
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
    await reopened.flush()

    expect(reopened.persistedSeq()).toBe(3)
    expect(await counts()).toEqual({ snapshots: 1, updates: 1, outbox: 3 })
  })
})
