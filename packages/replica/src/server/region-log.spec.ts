import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'

import {
  acceptEdits,
  countRows,
  deletionOf,
  nameIn,
  planFor,
  region,
  shallowSnapshotAt,
  snapshotAt,
  storedProfile,
} from './__fixtures__/log'
import { RegionLog } from './region-log'
import compactStatement from './surql/server-compact.surql'

let local: LocalDb

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()
})

afterEach(async () => {
  await local.close()
})

describe('server region log', () => {
  it('numbers accepted batches without gaps, also under concurrent accepts from two processes', async () => {
    const one = (await RegionLog.load(local, region))._unsafeUnwrap().log
    const two = (await RegionLog.load(local, region))._unsafeUnwrap().log

    const seqs = await Promise.all(
      Array.from({ length: 20 }, (_, n) => (n % 2 ? one : two).accept(planFor(`Ann ${n}`))),
    )

    expect(seqs.map((seq) => seq._unsafeUnwrap()).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, n) => n + 1),
    )
  })

  it('accepts nothing when the projection breaks a schema rule', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()

    const outcome = await log.accept(planFor('')) // profile.name ASSERT string::len($value) > 0

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(log.head()).toBe(0)
    expect(await countRows(local, '_replica_update')).toBe(0)
    expect(await countRows(local, 'profile')).toBe(0)
  })

  it('accepts nothing when the projection takes a unique value of another record', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()

    expect((await log.accept(planFor('Ann')))._unsafeUnwrap()).toBe(1)

    const outcome = await log.accept(planFor('Ann', 'prf_2')) // one profile per identity

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(log.head()).toBe(1)
    expect(await countRows(local, '_replica_update')).toBe(1)
    expect(await countRows(local, 'profile')).toBe(1)
  })

  it('deletes before it upserts, so a batch can move a unique value to a new record', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()

    expect((await log.accept(planFor('Ann')))._unsafeUnwrap()).toBe(1)

    const moved = planFor('Ann', 'prf_2') // the same identity under a new key
    const deletes = [{ table: 'profile', key: 'prf_1', entry: 'profile/prf_1' }]
    const outcome = await log.accept({ ...moved, deletes })

    expect(outcome._unsafeUnwrap()).toBe(2)
    expect(await countRows(local, 'profile')).toBe(1)
    expect(await countRows(local, '_replica_projected')).toBe(1)
  })

  it('accepts nothing when a projected value has the wrong type', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()
    const plan = planFor('Ann')
    const upserts = plan.upserts.map((row) => ({ ...row, data: { ...row.data, email: 42 } }))

    const outcome = await log.accept({ ...plan, upserts })

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(log.head()).toBe(0)
    expect(await countRows(local, '_replica_update')).toBe(0)
  })

  it('accepts nothing when the projection changes a read-only field', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()

    expect((await log.accept(planFor('Ann')))._unsafeUnwrap()).toBe(1)

    const plan = planFor('Ana')
    const upserts = plan.upserts.map((row) => ({
      ...row,
      data: { ...row.data, created_at: new Date(0) },
    }))
    const outcome = await log.accept({ ...plan, upserts })

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(log.head()).toBe(1)
    expect(await countRows(local, '_replica_update')).toBe(1)
  })

  it('accepts nothing when the projection writes a field the table does not define', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()
    const plan = planFor('Ann')
    const upserts = plan.upserts.map((row) => ({
      ...row,
      data: { ...row.data, nickname: 'Annie' },
    }))

    const outcome = await log.accept({ ...plan, upserts })

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(log.head()).toBe(0)
    expect(await countRows(local, '_replica_update')).toBe(0)
  })

  it('rolls back the records a refused batch wrote before the one that broke a rule', async () => {
    const { log } = (await RegionLog.load(local, region))._unsafeUnwrap()
    const plan = planFor('Ann')
    const upserts = [...plan.upserts, ...planFor('', 'prf_2').upserts]

    const outcome = await log.accept({ ...plan, upserts })

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(await countRows(local, 'profile')).toBe(0)
    expect(await countRows(local, '_replica_projected')).toBe(0)
    expect(await countRows(local, '_replica_update')).toBe(0)
    expect(await countRows(local, '_replica_head')).toBe(0)
  })

  it('loads a region from its snapshot and the rows after it', async () => {
    const { log, doc } = (await RegionLog.load(local, region))._unsafeUnwrap()

    await acceptEdits(log, doc, ['Ann', 'Ana', 'Anna'])
    expect((await log.compact(2, snapshotAt(doc, 2)))._unsafeUnwrap()).toBe('accepted')
    expect(await countRows(local, '_replica_update')).toBe(1)

    const reloaded = (await RegionLog.load(local, region))._unsafeUnwrap()

    expect(reloaded.log.head()).toBe(3)
    expect(reloaded.log.covers()).toBe(2)
    expect(nameIn(reloaded.doc)).toBe('Anna')
  })

  it('refuses a compaction beyond the head, behind the last one, or of another version', async () => {
    const { log, doc } = (await RegionLog.load(local, region))._unsafeUnwrap()

    await acceptEdits(log, doc, ['Ann', 'Ana'])

    expect((await log.compact(3, snapshotAt(doc, 2)))._unsafeUnwrap()).toBe('beyond-head')
    expect((await log.compact(2, snapshotAt(doc, 1)))._unsafeUnwrap()).toBe('version-mismatch')
    expect((await log.compact(2, snapshotAt(doc, 2)))._unsafeUnwrap()).toBe('accepted')
    expect((await log.compact(1, snapshotAt(doc, 1)))._unsafeUnwrap()).toBe('stale')
  })

  it('refuses a shallow snapshot, which lacks the history older updates depend on', async () => {
    const { log, doc } = (await RegionLog.load(local, region))._unsafeUnwrap()

    await acceptEdits(log, doc, ['Ann', 'Ana'])

    const outcome = await log.compact(2, shallowSnapshotAt(doc, 2))

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(log.covers()).toBe(0)
    expect(await countRows(local, '_replica_update')).toBe(2)
    expect(await countRows(local, '_replica_snapshot')).toBe(0)
  })

  it('reports a compaction that another process carried out first as stale', async () => {
    const { log, doc } = (await RegionLog.load(local, region))._unsafeUnwrap()

    await acceptEdits(log, doc, ['Ann', 'Ana'])
    let reached = () => {}
    let release = () => {}
    const atCompaction = new Promise<void>((resolve) => {
      reached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = interceptQueries(local, (text) => {
      if (text === compactStatement) {
        reached()

        return gate
      }
    })
    const late = (await RegionLog.load(slow, region))._unsafeUnwrap().log

    const outcome = late.compact(2, snapshotAt(doc, 2))

    await atCompaction
    expect((await log.compact(2, snapshotAt(doc, 2)))._unsafeUnwrap()).toBe('accepted')
    release()

    expect((await outcome)._unsafeUnwrap()).toBe('stale')
  })
})

describe('record ownership across regions on one database', () => {
  const other = 'identity:idn_b'

  it('refuses a batch of another region that writes a record this region owns, keeping the record', async () => {
    const mine = (await RegionLog.load(local, region))._unsafeUnwrap().log
    const theirs = (await RegionLog.load(local, other))._unsafeUnwrap().log

    expect((await mine.accept(planFor('Ann')))._unsafeUnwrap()).toBe(1)

    // The other region's own profile goes first, so no unique value stands in the way.
    const outcome = await theirs.accept(planFor('Taken', 'prf_1', other))

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(outcome._unsafeUnwrapErr().message).toMatch(/^ownership: profile\/prf_1 /)
    expect(theirs.head()).toBe(0)
    expect(await storedProfile(local, 'prf_1')).toEqual({ name: 'Ann', identity: region })
    expect(await countRows(local, '_replica_update')).toBe(1)
  })

  it('refuses a batch of another region that deletes a record this region owns', async () => {
    const mine = (await RegionLog.load(local, region))._unsafeUnwrap().log
    const theirs = (await RegionLog.load(local, other))._unsafeUnwrap().log

    expect((await mine.accept(planFor('Ann')))._unsafeUnwrap()).toBe(1)

    const outcome = await theirs.accept(deletionOf('prf_1', other))

    expect(outcome._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(outcome._unsafeUnwrapErr().message).toMatch(/^ownership: profile\/prf_1 /)
    expect(await storedProfile(local, 'prf_1')).toEqual({ name: 'Ann', identity: region })
    expect(await countRows(local, '_replica_projected')).toBe(1)
  })

  it('labels a unique-index refusal on a record key that looks like an ownership refusal as the index one', async () => {
    const mine = (await RegionLog.load(local, region))._unsafeUnwrap().log

    expect((await mine.accept(planFor('Ann', 'ownership:x')))._unsafeUnwrap()).toBe(1)

    // One profile per identity: the second breaks the index, whose message ends with the record `ownership:x`.
    const outcome = await mine.accept(planFor('Ann'))
    const error = outcome._unsafeUnwrapErr()

    expect(error.code).toBe('data:WRITE_REJECTED')
    expect(error.message).not.toMatch(/^ownership/)
    expect(error.message).toBe(`a batch of ${region} breaks a schema rule`)
    expect(String(error.cause)).toMatch(/profile_identity.*ownership:x/)
  })

  it('accepts a record under a key nobody holds yet, next to the records of another region', async () => {
    const mine = (await RegionLog.load(local, region))._unsafeUnwrap().log
    const theirs = (await RegionLog.load(local, other))._unsafeUnwrap().log

    expect((await mine.accept(planFor('Ann')))._unsafeUnwrap()).toBe(1)
    expect((await theirs.accept(planFor('Bea', 'prf_2', other)))._unsafeUnwrap()).toBe(1)
    expect((await theirs.accept(planFor('Bee', 'prf_2', other)))._unsafeUnwrap()).toBe(2)

    expect(await storedProfile(local, 'prf_1')).toEqual({ name: 'Ann', identity: region })
    expect(await storedProfile(local, 'prf_2')).toEqual({ name: 'Bee', identity: other })
  })
})
