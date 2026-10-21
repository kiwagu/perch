import { LoroMap } from 'loro-crdt'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'

import acceptAppends from './__fixtures__/accept-appends.surql'
import bumpHeadStatement from './__fixtures__/bump-head.surql'
import duplicateSeqStatement from './__fixtures__/duplicate-seq.surql'
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
import { replaceRegionDoc } from './region-replacement'
import { RegionStore } from './region-store'
import appendStatement from './surql/replica-append.surql'
import loadStatement from './surql/replica-load.surql'
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

/** A server update that depends on an earlier one, and that earlier one. */
function updateWithMissingHistory(): { gap: Uint8Array; fill: Uint8Array } {
  const author = RegionDoc.inMemory('private', ref.id)

  author.records().setContainer(key, new LoroMap()).set('name', 'Ann')
  author.doc.commit()
  const before = author.doc.version()
  const fill = author.doc.export({ mode: 'update' })

  author.recordMap(key).set('name', 'Ana')
  author.doc.commit()

  return { gap: author.doc.export({ mode: 'update', from: before }), fill }
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

  it('writes an update again at once under the next number when another engine took its number', async () => {
    let attempts = 0
    // Two engines on one database (the tabs of a browser): the other one commits row 1 while
    // this one still reads the head before it, then its head shows by the time this one replays.
    const racing = interceptQueries(local, async (text) => {
      if (text !== appendStatement) {
        return
      }

      attempts += 1

      if (attempts === 1) {
        await local.db.query(duplicateSeqStatement, {
          table: '_replica_update',
          region: ref.id,
          seq: 1,
          bytes: new Uint8Array([1]),
        })
      } else if (attempts === 2) {
        await local.db.query(bumpHeadStatement, { region: ref.id, head: 1 })
      }
    })
    const region = (await RegionDoc.open(racing, ref))._unsafeUnwrap()

    writeName(region, 'Ann')

    expect((await region.flush()).isOk()).toBe(true)
    expect(attempts).toBe(2)
    expect(region.persistedSeq()).toBe(2)
    expect((await region.outbox(10))._unsafeUnwrap().map((row) => row.seq)).toEqual([2])
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

  it('reports an append a broken connection refuses through flush', async () => {
    const refusal = new Error('the connection is gone')
    const broken = interceptQueries(local, (text) => {
      if (text.includes('_replica_outbox')) {
        throw refusal
      }
    })
    const region = (await RegionDoc.open(broken, ref))._unsafeUnwrap()

    writeName(region, 'Ann')
    const failure = (await region.flush())._unsafeUnwrapErr()

    expect(failure.code).toBe('data:WRITE_FAILED')
    expect(failure.cause).toBe(refusal)
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

  // The gateway binds a peer to the identity of its first batch: honest documents never share one.
  it('writes as a Loro peer of its own at each opening', async () => {
    const first = await open()
    const firstPeer = first.doc.peerIdStr

    first.close()

    const second = await open()

    expect(second.doc.peerIdStr).not.toBe(firstPeer)
    expect(RegionDoc.inMemory('tenant').doc.peerIdStr).not.toBe(
      RegionDoc.inMemory('tenant').doc.peerIdStr,
    )
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
    const { gap, fill } = updateWithMissingHistory()
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

  it('refuses to compact while an imported update still waits for its history', async () => {
    const { gap, fill } = updateWithMissingHistory()
    const region = await open()

    expect((await region.importRemote(gap, 2))._unsafeUnwrap().complete).toBe(false)

    expect((await region.compact())._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(await counts()).toEqual({ snapshots: 0, updates: 1, outbox: 0 })

    expect((await region.importRemote(fill, 3))._unsafeUnwrap().complete).toBe(true)
    expect((await region.compact()).isOk()).toBe(true)
    expect(await counts()).toEqual({ snapshots: 1, updates: 0, outbox: 0 })
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

    for (let n = 0; n < 10; n += 1) {
      writeName(first, `Ann ${n}`)
      writeName(second, `Beto ${n}`, otherKey)
    }

    expect((await first.flush()).isOk()).toBe(true)
    expect((await second.flush()).isOk()).toBe(true)

    const rows = (await first.outbox(100))._unsafeUnwrap()

    expect(rows.map((row) => row.seq)).toEqual(Array.from({ length: 20 }, (_, n) => n + 1))
    expect(new Set(rows.map((row) => row.id)).size).toBe(20)
    expect(await counts()).toEqual({ snapshots: 0, updates: 20, outbox: 20 })
  })

  it.each([
    ['_replica_update', 'replica_update_seq'],
    ['_replica_outbox', 'replica_outbox_seq'],
  ])('refuses a second row of %s under a number the region already holds', async (table, index) => {
    const region = await open()

    writeName(region, 'Ann')
    expect((await region.flush()).isOk()).toBe(true)

    await expect(
      local.db.query(duplicateSeqStatement, {
        table,
        region: ref.id,
        seq: 1,
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(index)
  })

  it('imports what another tab appended', async () => {
    const first = await open()
    const second = await open()

    writeName(first, 'Ann')
    expect((await first.flush()).isOk()).toBe(true)

    expect((await second.catchUpLocal())._unsafeUnwrap()).toBe(1)
    expect(second.recordJson(key)).toMatchObject({ name: 'Ann' })
  })

  it('announces a catch-up as an import, also when it reads its own rows again', async () => {
    const first = await open()
    const second = await open()
    const seen: string[] = []

    writeName(second, 'Beto', otherKey)
    expect((await second.flush()).isOk()).toBe(true)
    writeName(first, 'Ann')
    expect((await first.flush()).isOk()).toBe(true)
    second.doc.subscribe((batch) => seen.push(batch.by))

    // The log holds the second tab's own row before the first tab's; a projector follows
    // imports only, never checkouts, so a catch-up must not read as a checkout.
    expect((await second.catchUpLocal())._unsafeUnwrap()).toBe(2)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(seen).toEqual(['import'])
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

  it('hands a tab that read less than a compaction covers the snapshot first, then the rows after it', async () => {
    const lagging = await open()
    const first = await open()
    const second = await open()
    const thirdKey = 'profile/prf_0000000000000002.01m52pexcp'
    const seen: string[] = []

    writeName(first, 'Ann')
    expect((await first.flush()).isOk()).toBe(true)
    writeName(second, 'Beto', otherKey)
    expect((await second.flush()).isOk()).toBe(true)
    // The rows the lagging tab has not read yet go into the snapshot.
    expect((await second.compact()).isOk()).toBe(true)
    writeName(first, 'Cleo', thirdKey)
    expect((await first.flush()).isOk()).toBe(true)
    lagging.doc.subscribe((batch) => seen.push(batch.by))

    expect((await lagging.catchUpLocal()).isOk()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(lagging.recordJson(key)).toMatchObject({ name: 'Ann' })
    expect(lagging.recordJson(otherKey)).toMatchObject({ name: 'Beto' })
    expect(lagging.recordJson(thirdKey)).toMatchObject({ name: 'Cleo' })
    // A projector follows imports only.
    expect(new Set(seen)).toEqual(new Set(['import']))
  })

  it('opens a compacted region at what its snapshot covers', async () => {
    const first = await open()

    writeName(first, 'Ann')
    writeName(first, 'Ana')
    expect((await first.flush()).isOk()).toBe(true)
    expect((await first.compact()).isOk()).toBe(true)

    expect((await open()).persistedSeq()).toBe(2)
  })

  it('compacts once more rows than the limit built up past its snapshot, and not before', async () => {
    const region = await open()

    for (const name of ['Ann', 'Ana', 'Anna']) {
      writeName(region, name)
    }

    expect((await region.flush()).isOk()).toBe(true)
    expect((await region.compactIfLong(3))._unsafeUnwrap()).toBe(false)

    writeName(region, 'Annie')
    expect((await region.flush()).isOk()).toBe(true)
    expect((await region.compactIfLong(3))._unsafeUnwrap()).toBe(true)
    expect(await counts()).toMatchObject({ snapshots: 1, updates: 0 })

    // Counted from the new snapshot on.
    writeName(region, 'Anny')
    expect((await region.flush()).isOk()).toBe(true)
    expect((await region.compactIfLong(3))._unsafeUnwrap()).toBe(false)
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

    const [first] = (await region.outbox(10))._unsafeUnwrap()

    expect((await region.acknowledge(first ? [first] : [])).isOk()).toBe(true)

    expect((await region.outbox(10))._unsafeUnwrap().map((row) => row.seq)).toEqual([2])
  })

  it('drops exactly the rows acknowledged, never one under a lower number that was not pushed', async () => {
    const region = await open()

    writeName(region, 'Ann')
    writeName(region, 'Ana')
    writeName(region, 'Anna')
    expect((await region.flush()).isOk()).toBe(true)

    const rows = (await region.outbox(10))._unsafeUnwrap()

    expect(rows.every((row) => typeof row.id === 'string' && row.id.length > 0)).toBe(true)
    expect((await region.acknowledge(rows.slice(2))).isOk()).toBe(true)

    expect((await region.outbox(10))._unsafeUnwrap().map((row) => row.seq)).toEqual([1, 2])
  })
})

describe('a region reset on the device', () => {
  const reset = async (region: RegionDoc) =>
    (await replaceRegionDoc(local, region, 'reset'))._unsafeUnwrap()

  it("drops the region's snapshot, log, outbox and cursor, and numbers new rows after the old ones", async () => {
    const region = await open()

    writeName(region, 'Ann')
    writeName(region, 'Ana')
    expect((await region.flush()).isOk()).toBe(true)
    expect((await region.importRemote(updateWithMissingHistory().fill, 7)).isOk()).toBe(true)
    expect((await region.compact()).isOk()).toBe(true)

    const fresh = await reset(region)

    expect(fresh.recordJson(key)).toBeUndefined()
    expect(fresh.pulled()).toBe(0)
    expect((await fresh.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(await counts()).toEqual({ snapshots: 0, updates: 0, outbox: 0 })

    writeName(fresh, 'Bea')
    expect((await fresh.flush()).isOk()).toBe(true)
    expect((await fresh.outbox(10))._unsafeUnwrap().map((row) => row.seq)).toEqual([4])
  })

  it('refuses the writes of a document opened before the reset', async () => {
    const old = await open()

    await reset(await open())
    writeName(old, 'Late')

    expect((await old.flush())._unsafeUnwrapErr().code).toBe('data:REGION_STALE')
    expect((await (await open()).outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('opens a region reset while it loads as stale, never under the new generation', async () => {
    const before = await open()

    writeName(before, 'Ann')
    expect((await before.flush()).isOk()).toBe(true)

    // Another tab resets the region while this one reads it.
    let reset: Promise<void> | undefined
    const resetting = interceptQueries(local, (text) => {
      if (text === loadStatement) {
        reset ??= RegionStore.reset(local, ref.id).match(
          () => undefined,
          (error) => expect.unreachable(error.message),
        )

        return reset
      }

      return undefined
    })
    const opened = (await RegionDoc.open(resetting, ref))._unsafeUnwrap()

    expect(reset).toBeDefined()
    expect((await opened.stale())._unsafeUnwrap()).toBe(true)
    writeName(opened, 'Late')
    expect((await opened.flush())._unsafeUnwrapErr().code).toBe('data:REGION_STALE')
  })

  it('refuses its catch-up and imports nothing', async () => {
    const old = await open()
    const fresh = await reset(await open())

    writeName(fresh, 'New')
    expect((await fresh.flush()).isOk()).toBe(true)

    expect((await old.catchUpLocal())._unsafeUnwrapErr().code).toBe('data:REGION_STALE')
    expect(old.recordJson(key)).toBeUndefined()
  })

  it('refuses its server imports, its cursor and its compaction', async () => {
    const old = await open()

    await reset(await open())

    expect(
      (await old.importRemote(updateWithMissingHistory().fill, 5))._unsafeUnwrapErr().code,
    ).toBe('data:REGION_STALE')
    expect((await old.advanceCursor(5))._unsafeUnwrapErr().code).toBe('data:REGION_STALE')
    expect((await old.compact())._unsafeUnwrapErr().code).toBe('data:REGION_STALE')
    expect((await open()).pulled()).toBe(0)
  })

  it('tells a document of an earlier generation', async () => {
    const old = await open()
    const fresh = await reset(await open())

    expect((await old.stale())._unsafeUnwrap()).toBe(true)
    expect((await fresh.stale())._unsafeUnwrap()).toBe(false)
    expect((await RegionDoc.inMemory('private', ref.id).stale())._unsafeUnwrap()).toBe(false)
  })

  it('leaves the other regions of the database alone', async () => {
    const other: RegionRef = { kind: 'private', id: 'identity:idn_0000000000000001.01m52pexcp' }
    const mine = await open()
    const theirs = (await RegionDoc.open(local, other))._unsafeUnwrap()

    writeName(mine, 'Ann')
    writeName(theirs, 'Bob')
    expect((await mine.flush()).isOk()).toBe(true)
    expect((await theirs.flush()).isOk()).toBe(true)

    await reset(mine)

    const again = (await RegionDoc.open(local, other))._unsafeUnwrap()

    expect(again.recordJson(key)).toMatchObject({ name: 'Bob' })
    expect((await again.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })
})
