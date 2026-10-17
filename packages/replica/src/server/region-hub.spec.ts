import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { noteIdFactory } from '@workspace/ids'
import { defineAbilityFor } from '@workspace/kernel'

import bumpHeadStatement from '../__fixtures__/bump-head.surql'
import { noteCreate, noteUpdate, replicaSchema } from '../__fixtures__/note'

import {
  actor,
  closeHubs,
  editFrom,
  hubWithHistory,
  hubWithTwoSubscribers,
  nameInSnapshot,
  openDatabase,
  openHub,
  region,
  snapshotIn,
  snapshotOf,
  subscriber,
} from './__fixtures__/hub'
import { countRows, forgedHistory, nameIn, storedSnapshot } from './__fixtures__/log'
import { singleDatabase } from './region-databases'
import type { Actor, Subscriber } from './region-hub'
import { RegionLog } from './region-log'
import acceptStatement from './surql/server-accept.surql'
import headsStatement from './surql/server-heads.surql'
import loadStatement from './surql/server-load.surql'

afterEach(closeHubs)

/** What a member of the organisation does through a subscription: the abilities its role gives. */
function memberOf(id: string, role: 'member' | 'admin' = 'member'): Actor {
  return { id, ability: defineAbilityFor({ id, role }, replicaSchema) }
}

describe('region hub', () => {
  it('acknowledges a push and sends it to the other subscribers of the region', async () => {
    const { hub, a, b } = await hubWithTwoSubscribers()
    const update = editFrom(a.doc, 'Ana')

    expect((await hub.push(region.id, a, 1, [update])).isOk()).toBe(true)

    expect(a.received).toContainEqual(
      expect.objectContaining({ type: 'ack', batch: 1, head: 1, compact: false }),
    )
    expect(b.received).toContainEqual(
      expect.objectContaining({ type: 'updates', head: 1, snapshot: false }),
    )
    expect(a.received.filter((m) => m.type === 'updates' && m.head === 1)).toEqual([])
    expect(nameIn(b.doc)).toBe('Ana')
  })

  it('answers a subscription without a version with a full snapshot', async () => {
    const { hub, fresh } = await hubWithHistory(['Ann', 'Ana'])

    expect((await hub.subscribe(region, actor, fresh, null)).isOk()).toBe(true)

    expect(fresh.received).toContainEqual(
      expect.objectContaining({ type: 'updates', snapshot: true, head: 2 }),
    )
  })

  it('answers a subscription or a pull with a version with only what the device lacks', async () => {
    const { hub, a, fresh } = await hubWithHistory(['Ann'])

    fresh.doc.import(snapshotOf(a.doc))
    const known = fresh.doc.version().encode()

    expect((await hub.push(region.id, a, 2, [editFrom(a.doc, 'Ana')])).isOk()).toBe(true)
    expect((await hub.subscribe(region, actor, fresh, known)).isOk()).toBe(true)
    expect((await hub.pull(region.id, fresh, known)).isOk()).toBe(true)

    const answers = fresh.received.filter((m) => m.type === 'updates')

    expect(answers.map(({ head, snapshot }) => ({ head, snapshot }))).toEqual([
      { head: 2, snapshot: false },
      { head: 2, snapshot: false },
    ])
    expect(answers[0]?.bytes.length).toBeLessThan(snapshotOf(a.doc).length)
    expect(nameIn(fresh.doc)).toBe('Ana')
  })

  it('rejects a batch the projection refuses and keeps the document as it was', async () => {
    const { hub, a, b } = await hubWithTwoSubscribers()

    expect((await hub.push(region.id, a, 1, [editFrom(a.doc, '')])).isOk()).toBe(true)

    expect(a.received).toContainEqual(
      expect.objectContaining({ type: 'reject', batch: 1, reason: 'invalid-record' }),
    )
    expect(b.received.filter((m) => m.type === 'updates' && m.head > 0)).toEqual([])
    expect((await hub.heads([region.id]))._unsafeUnwrap()).toEqual([{ region: region.id, head: 0 }])

    const fresh = subscriber('fresh')

    expect((await hub.subscribe(region, actor, fresh, null)).isOk()).toBe(true)
    expect(snapshotIn(fresh).getMap('records').toJSON()).toEqual({})
  })

  it('keeps the stored value of a record when a later edit of it is refused', async () => {
    const { hub, a, fresh } = await hubWithHistory(['Ann'])

    expect((await hub.push(region.id, a, 2, [editFrom(a.doc, '')])).isOk()).toBe(true)
    expect(a.received.at(-1)).toEqual(expect.objectContaining({ type: 'reject', batch: 2 }))

    expect((await hub.subscribe(region, actor, fresh, null)).isOk()).toBe(true)
    expect(fresh.received).toEqual([expect.objectContaining({ type: 'updates', head: 1 })])
    expect(nameInSnapshot(fresh)).toBe('Ann')
  })

  it('rejects as foreign-owner a batch of another region that writes a record this region owns', async () => {
    const { hub, fresh } = await hubWithHistory(['Ann'])
    const theirs = { kind: 'private', id: 'identity:idn_b' } as const
    const intruder = subscriber('intruder')

    expect((await hub.subscribe(theirs, { ...actor, id: 'idn_b' }, intruder, null)).isOk()).toBe(
      true,
    )
    expect(
      (await hub.push(theirs.id, intruder, 1, [editFrom(intruder.doc, 'Taken', theirs.id)])).isOk(),
    ).toBe(true)

    expect(intruder.received.at(-1)).toEqual(
      expect.objectContaining({ type: 'reject', batch: 1, reason: 'foreign-owner' }),
    )
    expect((await hub.heads([theirs.id]))._unsafeUnwrap()).toEqual([{ region: theirs.id, head: 0 }])
    expect((await hub.subscribe(region, actor, fresh, null)).isOk()).toBe(true)
    expect(nameInSnapshot(fresh)).toBe('Ann')
  })

  it('names the schema rule a refused projection broke, in at most 200 characters', async () => {
    const { hub, a } = await hubWithTwoSubscribers()

    expect((await hub.push(region.id, a, 1, [editFrom(a.doc, '')])).isOk()).toBe(true)

    const reject = a.received.find((m) => m.type === 'reject')

    expect(reject?.detail).toContain('string::len($value) > 0')
    expect(reject?.detail.length).toBeLessThanOrEqual(200)
  })

  it('answers a batch the database fails to store with an internal error and reports it', async () => {
    const { hub, a, b, errors } = await hubWithTwoSubscribers({
      intercept: (text) => {
        if (text === acceptStatement) {
          throw new Error('the database went away')
        }
      },
    })

    expect((await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')])).isOk()).toBe(true)

    expect(a.received).toContainEqual(expect.objectContaining({ type: 'error', code: 'internal' }))
    expect(a.received.filter((m) => m.type === 'ack' || m.type === 'reject')).toEqual([])
    expect(errors.map((error) => error.code)).toEqual(['data:WRITE_FAILED'])
    expect(b.received.filter((m) => m.type === 'updates' && m.head > 0)).toEqual([])

    const fresh = subscriber('fresh')

    expect((await hub.subscribe(region, actor, fresh, null)).isOk()).toBe(true)
    expect(snapshotIn(fresh).getMap('records').toJSON()).toEqual({})
  })

  it('keeps answering and fanning out when one subscriber fails to take a message', async () => {
    const { hub, a, b, errors } = await hubWithTwoSubscribers()
    const broken = subscriber('broken')
    const failing: Subscriber = {
      id: broken.id,
      send(message) {
        if (message.type === 'updates' && !message.snapshot) {
          throw new Error('the socket is closed')
        }

        broken.send(message)
      },
    }
    const c = subscriber('c')

    for (const device of [failing, c]) {
      expect((await hub.subscribe(region, actor, device, null)).isOk()).toBe(true)
    }

    expect((await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')])).isOk()).toBe(true)

    expect(a.received).toContainEqual(expect.objectContaining({ type: 'ack', batch: 1, head: 1 }))

    for (const device of [b, c]) {
      expect(device.received).toContainEqual(
        expect.objectContaining({ type: 'updates', head: 1, snapshot: false }),
      )
    }

    expect(errors.map((error) => error.code)).toEqual(['data:WRITE_FAILED'])
  })

  it('acknowledges a batch delivered again without storing it twice', async () => {
    const { hub, local, a, b } = await hubWithTwoSubscribers()
    const update = editFrom(a.doc, 'Ann')

    expect((await hub.push(region.id, a, 1, [update])).isOk()).toBe(true)
    expect((await hub.push(region.id, a, 1, [update])).isOk()).toBe(true)

    const acks = a.received.filter((m) => m.type === 'ack')

    expect(acks.map(({ batch, head }) => ({ batch, head }))).toEqual([
      { batch: 1, head: 1 },
      { batch: 1, head: 1 },
    ])
    expect(await countRows(local, '_replica_update')).toBe(1)
    expect(b.received.filter((m) => m.type === 'updates' && m.head === 1)).toHaveLength(1)
  })

  it('stores a batch pushed twice at once only once, as the work of a region runs in turn', async () => {
    const { hub, local, a } = await hubWithTwoSubscribers()
    const update = editFrom(a.doc, 'Ann')

    const outcomes = await Promise.all([
      hub.push(region.id, a, 1, [update]),
      hub.push(region.id, a, 1, [update]),
    ])

    expect(outcomes.every((outcome) => outcome.isOk())).toBe(true)
    expect(a.received.filter((m) => m.type === 'ack').map((m) => m.head)).toEqual([1, 1])
    expect(await countRows(local, '_replica_update')).toBe(1)
  })

  it('unloads a region nobody watches after the idle time and reloads it intact', async () => {
    const { hub, clock, a } = await hubWithHistory(['Ann', 'Ana'])

    hub.unsubscribe(region.id, a.id)

    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)

    const again = subscriber('again')

    expect((await hub.subscribe(region, actor, again, null)).isOk()).toBe(true)
    expect(nameInSnapshot(again)).toBe('Ana')
  })

  it('keeps a region loaded when a device subscribes again before the idle time', async () => {
    const { hub, clock, a } = await hubWithHistory(['Ann'])

    hub.unsubscribe(region.id, a.id)
    await clock.advance(30_000)
    expect((await hub.subscribe(region, actor, subscriber('again'), null)).isOk()).toBe(true)

    expect(clock.pending()).toBe(0)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(1)
  })

  it('loads a region once for subscriptions that arrive together', async () => {
    let loads = 0
    const { hub } = await openHub({
      intercept: (text) => {
        if (text === loadStatement) {
          loads += 1
        }
      },
    })
    const a = subscriber('a')
    const b = subscriber('b')

    const outcomes = await Promise.all([
      hub.subscribe(region, actor, a, null),
      hub.subscribe(region, actor, b, null),
    ])

    expect(outcomes.every((outcome) => outcome.isOk())).toBe(true)
    expect(loads).toBe(1)
    expect([a, b].map((device) => device.received.map((m) => m.type))).toEqual([
      ['updates'],
      ['updates'],
    ])
  })

  it('answers the heads of loaded regions, unloaded ones and regions without a log', async () => {
    const { hub, clock, a } = await hubWithHistory(['Ann', 'Ana'])
    const unknown = 'identity:idn_b'

    expect((await hub.heads([region.id, unknown]))._unsafeUnwrap()).toEqual([
      { region: region.id, head: 2 },
      { region: unknown, head: 0 },
    ])

    hub.unsubscribe(region.id, a.id)
    await clock.advance(60_000)

    expect((await hub.heads([unknown, region.id]))._unsafeUnwrap()).toEqual([
      { region: unknown, head: 0 },
      { region: region.id, head: 2 },
    ])
  })

  it("acquires the region's database on load and releases it on unload", async () => {
    const counts = { acquired: 0, released: 0 }
    const { hub, clock } = await openHub({
      databases: (local) => ({
        acquire: (ref) => {
          counts.acquired += 1

          return singleDatabase(local)
            .acquire(ref)
            .map((database) => ({
              local: database.local,
              release: () => {
                counts.released += 1
              },
            }))
        },
      }),
    })
    const a = subscriber('a')

    expect((await hub.subscribe(region, actor, a, null)).isOk()).toBe(true)
    expect((await hub.subscribe(region, actor, subscriber('b'), null)).isOk()).toBe(true)
    expect(counts).toEqual({ acquired: 1, released: 0 })

    hub.unsubscribe(region.id, a.id)
    hub.unsubscribe(region.id, 'b')
    await clock.advance(60_000)

    expect(hub.loadedRegions()).toBe(0)
    expect(counts).toEqual({ acquired: 1, released: 1 })
  })

  it("heads of unloaded regions are read from each region's own database", async () => {
    const directory = await openDatabase()
    const acme = await openDatabase()

    await directory.db.query(bumpHeadStatement, { region: region.id, head: 3 })
    // The directory holds no head of the organisation's region: a stray one must not be read.
    await directory.db.query(bumpHeadStatement, { region: 'tenant:acme', head: 99 })
    await acme.db.query(bumpHeadStatement, { region: 'tenant:acme', head: 5 })

    const { hub } = await openHub({
      databases: () => ({
        acquire: (ref) =>
          okAsync({ local: ref.kind === 'tenant' ? acme : directory, release: () => {} }),
      }),
    })

    expect((await hub.heads(['tenant:acme', region.id, 'note:acme']))._unsafeUnwrap()).toEqual([
      { region: 'tenant:acme', head: 5 },
      { region: region.id, head: 3 },
      { region: 'note:acme', head: 0 },
    ])
  })

  it('checks a batch against the identity of the device that pushed it', async () => {
    const { hub } = await openHub()
    const acme = { kind: 'tenant', id: 'tenant:acme' } as const
    const ann = subscriber('ann')
    const bob = subscriber('bob')

    expect((await hub.subscribe(acme, memberOf('idn_ann'), ann, null)).isOk()).toBe(true)
    expect((await hub.subscribe(acme, memberOf('idn_bob'), bob, null)).isOk()).toBe(true)

    const own = noteCreate(bob.doc, { id: 'nte_1', author: 'idn_bob', text: 'mine' })
    const forged = noteCreate(bob.doc, { id: 'nte_2', author: 'idn_ann', text: 'hers' })

    expect((await hub.push(acme.id, bob, 1, [own])).isOk()).toBe(true)
    expect((await hub.push(acme.id, bob, 2, [forged])).isOk()).toBe(true)

    expect(bob.received.filter((m) => m.type === 'ack' || m.type === 'reject')).toEqual([
      expect.objectContaining({ type: 'ack', batch: 1 }),
      expect.objectContaining({ type: 'reject', batch: 2, reason: 'foreign-owner' }),
    ])
  })

  it("rejects a member's edit of another member's note as forbidden-action and acknowledges the admin's", async () => {
    const { hub } = await openHub()
    const acme = { kind: 'tenant', id: 'tenant:acme' } as const
    const ann = subscriber('ann')
    const bob = subscriber('bob')
    const boss = subscriber('boss')
    const id = noteIdFactory.create()

    expect((await hub.subscribe(acme, memberOf('idn_ann'), ann, null)).isOk()).toBe(true)
    expect((await hub.subscribe(acme, memberOf('idn_bob'), bob, null)).isOk()).toBe(true)
    expect((await hub.subscribe(acme, memberOf('idn_boss', 'admin'), boss, null)).isOk()).toBe(true)

    expect(
      (
        await hub.push(acme.id, ann, 1, [
          noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' }),
        ])
      ).isOk(),
    ).toBe(true)
    expect(
      (await hub.push(acme.id, bob, 1, [noteUpdate(bob.doc, { id, text: 'mine now' })])).isOk(),
    ).toBe(true)
    expect(
      (
        await hub.push(acme.id, boss, 1, [
          noteUpdate(boss.doc, { id, text: 'edited by the admin' }),
        ])
      ).isOk(),
    ).toBe(true)

    expect(bob.received.filter((m) => m.type === 'ack' || m.type === 'reject')).toEqual([
      expect.objectContaining({
        type: 'reject',
        batch: 1,
        reason: 'forbidden-action',
        detail: `note/${id}:update`,
      }),
    ])
    expect(boss.received.filter((m) => m.type === 'ack')).toEqual([
      expect.objectContaining({ type: 'ack', batch: 1 }),
    ])
    expect(ann.received.filter((m) => m.type === 'updates').length).toBeGreaterThan(1)
  })

  it('answers the head of a region that unloads while the database is asked for others', async () => {
    let reached = () => {}
    let release = () => {}
    const atHeads = new Promise<void>((resolve) => {
      reached = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { hub, clock, a } = await hubWithHistory(['Ann', 'Ana'], {
      intercept: (text) => {
        if (text === headsStatement) {
          reached()

          return gate
        }
      },
    })
    const unknown = 'identity:idn_b'

    hub.unsubscribe(region.id, a.id)
    const answer = hub.heads([region.id, unknown])

    await atHeads
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)
    release()

    expect((await answer)._unsafeUnwrap()).toEqual([
      { region: region.id, head: 2 },
      { region: unknown, head: 0 },
    ])
  })

  it('asks for a compaction once the log outgrows the limit', async () => {
    const { hub, a } = await hubWithTwoSubscribers({ compactionLogLimit: 2 })

    for (const [batch, name] of [
      [1, 'A'],
      [2, 'B'],
      [3, 'C'],
    ] as const) {
      expect((await hub.push(region.id, a, batch, [editFrom(a.doc, name)])).isOk()).toBe(true)
    }

    const acks = a.received.filter((m) => m.type === 'ack')

    expect(acks.map((m) => m.compact)).toEqual([false, false, true])
  })

  it('reports the outcome of a compaction proposal to the proposer', async () => {
    const { hub, a, doc } = await hubWithHistory(['Ann', 'Ana'])

    expect((await hub.compact(region.id, a, 2, snapshotOf(doc))).isOk()).toBe(true)

    expect(a.received).toContainEqual({
      type: 'compaction',
      region: region.id,
      covers: 2,
      outcome: 'accepted',
    })
  })

  it('compacts into a snapshot of its own document: a forged history under the head version changes nothing', async () => {
    const { hub, a, doc, local } = await hubWithHistory(['Ann', 'Ana'])
    // The author's peer id and counters, other names: the version vector matches the head row's.
    const forged = forgedHistory(doc, ['Mallory', 'Eve'])

    expect((await hub.compact(region.id, a, 2, snapshotOf(forged))).isOk()).toBe(true)

    expect(a.received).toContainEqual({
      type: 'compaction',
      region: region.id,
      covers: 2,
      outcome: 'accepted',
    })
    expect(nameIn((await storedSnapshot(local)) ?? expect.unreachable('a snapshot'))).toBe('Ana')
    expect(nameIn((await RegionLog.load(local, region.id))._unsafeUnwrap().doc)).toBe('Ana')
  })

  it('compacts below the head into its own document as it was at that row, refusing another version', async () => {
    const { hub, a, doc, local } = await hubWithHistory(['Ann', 'Ana', 'Anna'])

    expect((await hub.compact(region.id, a, 2, snapshotOf(doc))).isOk()).toBe(true)
    expect(await storedSnapshot(local)).toBeUndefined()

    expect(
      (
        await hub.compact(region.id, a, 2, snapshotOf(forgedHistory(doc, ['Mallory', 'Eve'])))
      ).isOk(),
    ).toBe(true)

    expect(a.received.filter((m) => m.type === 'compaction')).toEqual([
      { type: 'compaction', region: region.id, covers: 2, outcome: 'version-mismatch' },
      { type: 'compaction', region: region.id, covers: 2, outcome: 'accepted' },
    ])

    const stored = (await storedSnapshot(local)) ?? expect.unreachable('a snapshot')

    expect(nameIn(stored)).toBe('Ana')
    expect(stored.version().compare(doc.version())).toBe(-1)
    expect(nameIn((await RegionLog.load(local, region.id))._unsafeUnwrap().doc)).toBe('Anna')
  })

  it('answers a snapshot the log refuses to compact into as a version mismatch', async () => {
    const { hub, a, doc, errors } = await hubWithHistory(['Ann', 'Ana'])
    const shallow = doc.export({ mode: 'shallow-snapshot', frontiers: doc.frontiers() })

    expect((await hub.compact(region.id, a, 2, shallow)).isOk()).toBe(true)

    expect(a.received).toContainEqual({
      type: 'compaction',
      region: region.id,
      covers: 2,
      outcome: 'version-mismatch',
    })
    expect(errors.map((error) => error.code)).toEqual(['data:WRITE_REJECTED'])
  })

  it('serializes pushes of one region: concurrent batches get consecutive heads', async () => {
    const { hub, a, b } = await hubWithTwoSubscribers()

    const outcomes = await Promise.all([
      hub.push(region.id, a, 1, [editFrom(a.doc, 'A')]),
      hub.push(region.id, b, 1, [editFrom(b.doc, 'B')]),
    ])

    expect(outcomes.every((outcome) => outcome.isOk())).toBe(true)

    const heads = [...a.received, ...b.received].filter((m) => m.type === 'ack').map((m) => m.head)

    expect(heads.sort()).toEqual([1, 2])
  })

  it('refuses a device that pushes or pulls without a subscription to the region', async () => {
    const { hub, local } = await hubWithTwoSubscribers()
    const stranger = subscriber('stranger')
    const update = editFrom(stranger.doc, 'Ann')
    const version = stranger.doc.version().encode()

    expect((await hub.push(region.id, stranger, 1, [update])).isOk()).toBe(true)
    expect((await hub.pull(region.id, stranger, version)).isOk()).toBe(true)
    expect((await hub.push('identity:idn_b', stranger, 1, [update])).isOk()).toBe(true)

    expect(stranger.received.map((m) => m.type === 'error' && m.code)).toEqual([
      'protocol',
      'protocol',
      'protocol',
    ])
    expect(await countRows(local, '_replica_update')).toBe(0)
    expect(hub.loadedRegions()).toBe(1)
  })

  it('refuses a version that does not decode', async () => {
    const { hub, a } = await hubWithTwoSubscribers()

    expect((await hub.pull(region.id, a, new Uint8Array([255, 255, 255]))).isOk()).toBe(true)

    expect(a.received.at(-1)).toEqual(expect.objectContaining({ type: 'error', code: 'protocol' }))
  })
})
