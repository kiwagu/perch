import { LoroMap } from 'loro-crdt'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import acceptAppends from './__fixtures__/accept-appends.surql'
import {
  createProfile,
  identityId,
  profileId,
  profileSchema,
  updateName,
} from './__fixtures__/profile'
import refuseAppends from './__fixtures__/refuse-appends.surql'
import countsStatement from './__fixtures__/replica-counts.surql'
import coversStatement from './__fixtures__/snapshot-covers.surql'
import { RegionDoc, type RegionRef } from './region-doc'
import { LoroWritePath } from './write-path'

const ref: RegionRef = { kind: 'private', id: `identity:${identityId}` }
const ann = { id: profileId, identity: identityId, name: 'Ann', email: 'ann@example.test' }
const key = `profile/${profileId}`
const otherKey = 'profile/prf_0000000000000001.01m52pexcp'

let local: LocalDb

const open = async () => (await RegionDoc.open(local, ref))._unsafeUnwrap()

function writeName(region: RegionDoc, name: string, recordKey: string = key): void {
  const record =
    region.recordJson(recordKey) === undefined
      ? region.records().setContainer(recordKey, new LoroMap())
      : region.recordMap(recordKey)

  record.set('name', name)
  region.doc.commit()
}

async function counts(): Promise<{ snapshots: number; updates: number; outbox: number }> {
  const [snapshots, updates, outbox] = (await local.db.query(countsStatement, {
    region: ref.id,
  })) as number[][]

  return { snapshots: snapshots?.[0] ?? 0, updates: updates?.[0] ?? 0, outbox: outbox?.[0] ?? 0 }
}

async function snapshotCovers(): Promise<number[]> {
  const [covers] = (await local.db.query(coversStatement, { region: ref.id })) as number[][]

  return covers ?? []
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

describe('RegionDoc sync state', () => {
  it('persists a server update before importing it and moves the cursor', async () => {
    const author = RegionDoc.inMemory('private', ref.id)

    author.records().setContainer(key, new LoroMap()).set('name', 'Ann')
    author.doc.commit()
    const region = await open()

    const outcome = await region.importRemote(author.doc.export({ mode: 'snapshot' }), 3)

    expect(outcome._unsafeUnwrap().complete).toBe(true)
    expect(region.pulled()).toBe(3)
    region.close()
    const reopened = await open()

    expect(reopened.recordJson(key)).toMatchObject({ name: 'Ann' })
    expect(reopened.pulled()).toBe(3)
  })

  it('keeps the cursor when the update depends on history it lacks', async () => {
    const author = RegionDoc.inMemory('private', ref.id)

    author.records().setContainer(key, new LoroMap()).set('name', 'Ann')
    author.doc.commit()
    const before = author.doc.version()

    author.recordMap(key).set('name', 'Ana')
    author.doc.commit()
    const region = await open()

    const outcome = await region.importRemote(
      author.doc.export({ mode: 'update', from: before }),
      2,
    )

    expect(outcome._unsafeUnwrap().complete).toBe(false)
    expect(region.pulled()).toBe(0)
  })

  it('keeps the cursor until every update an import left waiting has its history', async () => {
    const author = RegionDoc.inMemory('private', ref.id)

    author.records().setContainer(key, new LoroMap()).set('name', 'Ann')
    author.doc.commit()
    const before = author.doc.version()
    const fill = author.doc.export({ mode: 'update' })

    author.recordMap(key).set('name', 'Ana')
    author.doc.commit()
    const gap = author.doc.export({ mode: 'update', from: before })
    const other = RegionDoc.inMemory('private', ref.id)

    writeName(other, 'Beto', otherKey)
    const unrelated = other.doc.export({ mode: 'update' })
    const region = await open()

    expect((await region.importRemote(gap, 2))._unsafeUnwrap().complete).toBe(false)
    expect((await region.importRemote(unrelated, 3))._unsafeUnwrap().complete).toBe(false)
    expect(region.pulled()).toBe(0)

    expect((await region.importRemote(fill, 4))._unsafeUnwrap().complete).toBe(true)
    expect(region.pulled()).toBe(4)
    expect(region.recordJson(key)).toMatchObject({ name: 'Ana' })
  })

  it('refuses server bytes that are not a Loro update and stores nothing', async () => {
    const region = await open()

    const outcome = await region.importRemote(new Uint8Array([1, 2, 3, 4]), 1)

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(region.pulled()).toBe(0)
    expect(await counts()).toEqual({ snapshots: 0, updates: 0, outbox: 0 })
    region.close()

    expect((await RegionDoc.open(local, ref)).isOk()).toBe(true)
  })

  it('numbers updates in the database, so two tabs on one database never share a number', async () => {
    const first = await open()
    const second = await open()

    writeName(first, 'Ann')
    writeName(second, 'Beto')
    expect((await first.flush()).isOk()).toBe(true)
    expect((await second.flush()).isOk()).toBe(true)

    const rows = (await first.outbox(10))._unsafeUnwrap()

    expect(rows.map((row) => row.seq)).toEqual([1, 2])
  })

  it('imports what another tab appended', async () => {
    const first = await open()
    const second = await open()

    writeName(first, 'Ann')
    expect((await first.flush()).isOk()).toBe(true)

    expect((await second.catchUpLocal())._unsafeUnwrap()).toBe(1)
    expect(second.recordJson(key)).toMatchObject({ name: 'Ann' })
  })

  it('compacts only the log rows it has read, catching up with other tabs first', async () => {
    const first = await open()
    const second = await open()
    const third = await open()

    writeName(first, 'Ann')
    expect((await first.flush()).isOk()).toBe(true)
    writeName(second, 'Beto', otherKey)
    expect((await second.flush()).isOk()).toBe(true)

    expect((await third.catchUpLocal())._unsafeUnwrap()).toBe(2)
    expect((await second.compact()).isOk()).toBe(true)
    second.close()
    const reopened = await open()

    expect(reopened.recordJson(key)).toMatchObject({ name: 'Ann' })
    expect(reopened.recordJson(otherKey)).toMatchObject({ name: 'Beto' })
    expect(await snapshotCovers()).toEqual([2])
    expect(await counts()).toEqual({ snapshots: 1, updates: 0, outbox: 2 })
  })

  it('moves the cursor forward only, and keeps it across a reopen', async () => {
    const region = await open()

    expect((await region.advanceCursor(4)).isOk()).toBe(true)
    expect((await region.advanceCursor(2)).isOk()).toBe(true)
    region.close()

    expect((await open()).pulled()).toBe(4)
  })

  it('drops acknowledged outbox rows and keeps later ones', async () => {
    const region = await open()

    writeName(region, 'Ann')
    writeName(region, 'Ana')
    expect((await region.flush()).isOk()).toBe(true)

    expect((await region.acknowledge(1)).isOk()).toBe(true)

    expect((await region.outbox(10))._unsafeUnwrap().map((row) => row.seq)).toEqual([2])
  })
})
