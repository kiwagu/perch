import { LoroDoc, type LoroMap } from 'loro-crdt'
import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { noteIdFactory } from '@workspace/ids'

import bumpHeadStatement from '../__fixtures__/bump-head.surql'
import { noteCreate, noteUpdate } from '../__fixtures__/note'

import {
  actor,
  closeHubs,
  editFrom,
  hubWithHistory,
  hubWithTwoSubscribers,
  memberOf,
  nameInSnapshot,
  openDatabase,
  openHub,
  region,
  setFrom,
  snapshotIn,
  snapshotOf,
  subscriber,
  underPeerOf,
} from './__fixtures__/hub'
import {
  countRows,
  forgedHistory,
  nameIn,
  profileIn,
  storedEmail,
  storedSnapshot,
} from './__fixtures__/log'
import type { RecordWrite } from './record-write'
import { type RegionDatabases, singleDatabase } from './region-databases'
import type { RegionHub, Subscriber } from './region-hub'
import { RegionLog } from './region-log'
import { SERVER_PEER } from './server-peer'
import acceptStatement from './surql/server-accept.surql'
import headsStatement from './surql/server-heads.surql'
import loadStatement from './surql/server-load.surql'

afterEach(closeHubs)

/** The fixture's database for every region, counting the holds taken on it and released. */
function counting() {
  const counts = { acquired: 0, released: 0 }
  const databases = (local: LocalDb): RegionDatabases => {
    const single = singleDatabase(local)

    return {
      databaseOf: (ref) => single.databaseOf(ref),
      acquire: (ref) => {
        counts.acquired += 1

        return single.acquire(ref).map((database) => ({
          local: database.local,
          release: () => {
            counts.released += 1
          },
        }))
      },
    }
  }

  return { counts, databases }
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
    const { counts, databases } = counting()
    const { hub, clock } = await openHub({ databases })
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

  it('releases the database of a region whose load fails, and keeps nothing loaded', async () => {
    const { counts, databases } = counting()
    const { hub, errors } = await openHub({
      databases,
      intercept: (text) => {
        if (text === loadStatement) {
          throw new Error('the database went away')
        }
      },
    })
    const a = subscriber('a')

    expect((await hub.subscribe(region, actor, a, null)).isOk()).toBe(true)
    expect(a.received).toEqual([expect.objectContaining({ type: 'error', code: 'internal' })])
    expect(errors).toHaveLength(1)
    expect(counts).toEqual({ acquired: 1, released: 1 })
    expect(hub.loadedRegions()).toBe(0)
  })

  it('releases on close the database of every region it holds, once', async () => {
    const { counts, databases } = counting()
    const { hub } = await openHub({ databases })
    const acme = { kind: 'tenant', id: 'tenant:acme' } as const

    expect((await hub.subscribe(region, actor, subscriber('a'), null)).isOk()).toBe(true)
    expect((await hub.subscribe(acme, memberOf('idn_a'), subscriber('b'), null)).isOk()).toBe(true)
    await hub.close()
    await hub.close()

    expect(counts).toEqual({ acquired: 2, released: 2 })
  })

  it('holds and loads nothing once closed: a subscription is answered with an internal error', async () => {
    const { counts, databases } = counting()
    const { hub } = await openHub({ databases })
    const a = subscriber('a')

    await hub.close()

    expect((await hub.subscribe(region, actor, a, null)).isOk()).toBe(true)
    // Whatever the subscription names: the closed hub answers it before anything else.
    expect(
      (await hub.subscribe({ kind: 'private', id: 'identity:idn_b' }, actor, a, null)).isOk(),
    ).toBe(true)
    expect((await hub.subscribe(region, actor, a, new Uint8Array([255]))).isOk()).toBe(true)
    expect(a.received).toEqual([
      expect.objectContaining({ type: 'error', code: 'internal' }),
      expect.objectContaining({ type: 'error', code: 'internal' }),
      expect.objectContaining({ type: 'error', code: 'internal' }),
    ])
    expect(counts.acquired).toBe(0)
    expect(hub.loadedRegions()).toBe(0)
  })

  it('refuses the private region of another identity as forbidden-region, holding nothing', async () => {
    const { counts, databases } = counting()
    const { hub } = await openHub({ databases })
    const a = subscriber('a')
    const others = { kind: 'private', id: 'identity:idn_b' } as const

    expect((await hub.subscribe(others, actor, a, null)).isOk()).toBe(true)
    expect(a.received).toEqual([
      expect.objectContaining({ type: 'error', code: 'forbidden-region' }),
    ])
    expect(counts.acquired).toBe(0)

    expect((await hub.push(others.id, a, 1, [editFrom(a.doc, 'Bea')])).isOk()).toBe(true)
    expect(a.received.filter((m) => m.type === 'ack' || m.type === 'reject')).toEqual([])
  })

  it('releases what it acquired to read the heads, also when the read fails', async () => {
    const { counts, databases } = counting()
    let failing = false
    const { hub } = await openHub({
      databases,
      intercept: (text) => {
        if (failing && text === headsStatement) {
          throw new Error('the database went away')
        }
      },
    })

    expect((await hub.heads([region.id, 'tenant:acme'])).isOk()).toBe(true)
    failing = true
    expect((await hub.heads([region.id, 'tenant:acme'])).isErr()).toBe(true)

    expect(counts.acquired).toBeGreaterThan(0)
    expect(counts.released).toBe(counts.acquired)
  })

  it('reads the heads of unloaded regions from the database the port names for each', async () => {
    const ann = await openDatabase()
    const bob = await openDatabase()

    await ann.db.query(bumpHeadStatement, { region: 'identity:idn_ann', head: 3 })
    await bob.db.query(bumpHeadStatement, { region: 'identity:idn_bob', head: 7 })

    // Private regions kept in a database each: the hub assumes no layout of its own.
    const { hub } = await openHub({
      databases: () => ({
        databaseOf: (ref) => ref.id,
        acquire: (ref) =>
          okAsync({ local: ref.id === 'identity:idn_ann' ? ann : bob, release: () => {} }),
      }),
    })

    expect((await hub.heads(['identity:idn_ann', 'identity:idn_bob']))._unsafeUnwrap()).toEqual([
      { region: 'identity:idn_ann', head: 3 },
      { region: 'identity:idn_bob', head: 7 },
    ])
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
        databaseOf: (ref) => (ref.kind === 'tenant' ? ref.id : 'directory'),
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
    // The other member receives the accepted batch, never the refused one.
    expect(
      ann.received.flatMap((m) => (m.type === 'updates' && !m.snapshot ? [m.head] : [])),
    ).toEqual([1])
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
    // Her snapshot at the subscription, then the admin's edit.
    expect(ann.received.filter((m) => m.type === 'updates')).toHaveLength(2)
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

  it("keeps a member's peer bound across the region's unload: after the reload another member's batch under it is refused as foreign-peer and the member's next batch is acknowledged", async () => {
    const { hub, clock } = await openHub()
    const acme = { kind: 'tenant', id: 'tenant:acme' } as const
    const ann = subscriber('ann')
    const bob = subscriber('bob')
    const id = noteIdFactory.create()

    ;(await hub.subscribe(acme, memberOf('idn_ann'), ann, null))._unsafeUnwrap()
    ;(await hub.subscribe(acme, memberOf('idn_bob'), bob, null))._unsafeUnwrap()
    ;(
      await hub.push(acme.id, ann, 1, [
        noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' }),
      ])
    )._unsafeUnwrap()

    hub.unsubscribe(acme.id, ann.id)
    hub.unsubscribe(acme.id, bob.id)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)

    ;(
      await hub.subscribe(acme, memberOf('idn_bob'), bob, bob.doc.version().encode())
    )._unsafeUnwrap()
    ;(
      await hub.push(acme.id, bob, 1, [
        noteCreate(underPeerOf(ann.doc, bob.doc), {
          id: noteIdFactory.create(),
          author: 'idn_bob',
          text: 'mine',
        }),
      ])
    )._unsafeUnwrap()
    ;(
      await hub.subscribe(acme, memberOf('idn_ann'), ann, ann.doc.version().encode())
    )._unsafeUnwrap()
    ;(
      await hub.push(acme.id, ann, 2, [noteUpdate(ann.doc, { id, text: 'hello again' })])
    )._unsafeUnwrap()

    expect(bob.received.findLast((m) => m.type === 'reject')).toMatchObject({
      batch: 1,
      reason: 'foreign-peer',
    })
    expect(ann.received.findLast((m) => m.type === 'ack')).toMatchObject({ batch: 2, head: 2 })
  })
})

const newEmail = 'ann@new.example.test'

/** The server sets the email of the owner's profile. */
const emailWrite: RecordWrite = { table: 'profile', id: 'prf_1', set: { email: newEmail } }

/** A promise a test settles by hand, to hold a query until it says so. */
function gate() {
  let open: () => void = () => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })

  return { opened, open }
}

/** Lets the work already asked of the hub run as far as it can. */
async function drain(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('a write of the server to a record', () => {
  it('is logged under the next head, projected, and sent to every subscriber of the region as updates', async () => {
    const { hub, local, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()

    expect((await hub.writeRecord(region, emailWrite))._unsafeUnwrap()).toBe(2)

    for (const device of [a, b]) {
      expect(device.received.at(-1)).toMatchObject({
        type: 'updates',
        region: region.id,
        head: 2,
        snapshot: false,
      })
      expect(profileIn(device.doc)).toMatchObject({ name: 'Ann', email: newEmail })
    }

    expect(await storedEmail(local, 'prf_1')).toBe(newEmail)
    expect(await countRows(local, '_replica_update')).toBe(2)
    expect((await hub.heads([region.id]))._unsafeUnwrap()).toEqual([{ region: region.id, head: 2 }])
  })

  it('reaches a device that was away at its next subscription from its version, as only what it lacks', async () => {
    const { hub, a, fresh } = await hubWithHistory(['Ann'])

    fresh.doc.import(snapshotOf(a.doc))
    const known = fresh.doc.version().encode()

    ;(await hub.writeRecord(region, emailWrite))._unsafeUnwrap()
    ;(await hub.subscribe(region, actor, fresh, known))._unsafeUnwrap()

    expect(fresh.received).toEqual([
      expect.objectContaining({ type: 'updates', head: 2, snapshot: false }),
    ])
    expect(profileIn(fresh.doc)).toMatchObject({ name: 'Ann', email: newEmail })
  })

  it("never interleaves with a device's batch: each waits for the other in the region's queue, and the numbers stay gapless", async () => {
    const held = gate()
    let holding = false
    let accepts = 0
    const { hub, local, a } = await hubWithTwoSubscribers({
      intercept: (text) => {
        if (text !== acceptStatement) {
          return undefined
        }

        accepts += 1

        return holding ? held.opened : undefined
      },
    })

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()

    // The server's write is stored first and held there; the device's next batch is asked meanwhile.
    holding = true
    const written = hub.writeRecord(region, emailWrite)

    await drain()
    holding = false
    const pushed = hub.push(region.id, a, 2, [setFrom(a.doc, 'name', 'Ana')])

    await drain()

    expect(accepts).toBe(2)

    held.open()

    expect((await written)._unsafeUnwrap()).toBe(2)
    ;(await pushed)._unsafeUnwrap()

    expect(a.received.findLast((m) => m.type === 'ack')).toMatchObject({ batch: 2, head: 3 })
    expect(await countRows(local, '_replica_update')).toBe(3)
    // The batch was checked and projected on a document that held the write.
    expect(await storedEmail(local, 'prf_1')).toBe(newEmail)
    expect(profileIn(snapshotIn(await subscribed(hub)))).toMatchObject({
      name: 'Ana',
      email: newEmail,
    })
  })

  it("waits for a device's batch under way before it is stored", async () => {
    const held = gate()
    let holding = false
    let accepts = 0
    const { hub, a } = await hubWithTwoSubscribers({
      intercept: (text) => {
        if (text !== acceptStatement) {
          return undefined
        }

        accepts += 1

        return holding ? held.opened : undefined
      },
    })

    holding = true
    const pushed = hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')])

    await drain()
    holding = false
    const written = hub.writeRecord(region, emailWrite)

    await drain()

    expect(accepts).toBe(1)

    held.open()
    ;(await pushed)._unsafeUnwrap()

    expect((await written)._unsafeUnwrap()).toBe(2)
    expect(a.received.findLast((m) => m.type === 'ack')).toMatchObject({ batch: 1, head: 1 })
  })

  it("refuses as foreign-peer a device's batch under the server's peer, storing nothing", async () => {
    const { hub, local, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()

    const forger = new LoroDoc()

    forger.import(snapshotOf(a.doc))
    forger.setPeerId(SERVER_PEER)
    const from = forger.version()

    ;(forger.getMap('records').get('profile/prf_1') as LoroMap).set('email', 'eve@example.test')
    forger.commit()
    ;(await hub.push(region.id, a, 2, [forger.export({ mode: 'update', from })]))._unsafeUnwrap()

    expect(a.received.at(-1)).toMatchObject({ type: 'reject', batch: 2, reason: 'foreign-peer' })
    expect(b.received.filter((m) => m.type === 'updates' && m.head > 1)).toEqual([])
    expect(await countRows(local, '_replica_update')).toBe(1)
    expect(await storedEmail(local, 'prf_1')).toBe('ann@example.test')

    // The server's own write under that peer is taken in as before.
    expect((await hub.writeRecord(region, emailWrite))._unsafeUnwrap()).toBe(2)
  })

  it("accepts the owner's later edit of another field of the record, and its edit made before the write reached it", async () => {
    const { hub, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()

    // Device b renames the profile before the server's write reaches it, and pushes after.
    const concurrent = setFrom(b.doc, 'name', 'Ana')

    ;(await hub.writeRecord(region, emailWrite))._unsafeUnwrap()
    ;(await hub.push(region.id, b, 1, [concurrent]))._unsafeUnwrap()
    ;(await hub.push(region.id, a, 2, [setFrom(a.doc, 'name', 'Anna')]))._unsafeUnwrap()

    expect(b.received.findLast((m) => m.type === 'ack')).toMatchObject({ batch: 1, head: 3 })
    expect(a.received.findLast((m) => m.type === 'ack')).toMatchObject({ batch: 2, head: 4 })

    for (const doc of [a.doc, b.doc, snapshotIn(await subscribed(hub))]) {
      expect(profileIn(doc)).toMatchObject({ name: 'Anna', email: newEmail })
    }
  })

  it("accepts the owner's concurrent write of the same field, and every copy settles on one value: the server's in a tie", async () => {
    const { hub, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()

    const concurrent = setFrom(b.doc, 'email', 'ann@other.example.test')

    ;(await hub.writeRecord(region, emailWrite))._unsafeUnwrap()
    ;(await hub.push(region.id, b, 1, [concurrent]))._unsafeUnwrap()

    expect(b.received.findLast((m) => m.type === 'ack')).toMatchObject({ batch: 1, head: 3 })

    for (const doc of [a.doc, b.doc, snapshotIn(await subscribed(hub))]) {
      expect(profileIn(doc)?.['email']).toBe(newEmail)
    }
  })

  it.each<[string, RecordWrite]>([
    ['an unknown record', { table: 'profile', id: 'prf_9', set: { email: newEmail } }],
    ['a field outside the table', { table: 'profile', id: 'prf_1', set: { nickname: 'Annie' } }],
    ['a value the projection refuses', { table: 'profile', id: 'prf_1', set: { name: '' } }],
  ])('refuses a write naming %s, logging and sending nothing', async (_, write) => {
    const { hub, local, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()
    const received = b.received.length

    expect((await hub.writeRecord(region, write))._unsafeUnwrapErr().code).toBe(
      'data:WRITE_REJECTED',
    )
    expect(b.received).toHaveLength(received)
    expect(await countRows(local, '_replica_update')).toBe(1)
    expect((await hub.heads([region.id]))._unsafeUnwrap()).toEqual([{ region: region.id, head: 1 }])
    expect(profileIn(snapshotIn(await subscribed(hub)))).toMatchObject({
      name: 'Ann',
      email: 'ann@example.test',
    })
  })

  it('logs and sends nothing for a write that sets every field to the value it holds', async () => {
    const { hub, local, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()
    const received = b.received.length

    expect(
      (
        await hub.writeRecord(region, {
          table: 'profile',
          id: 'prf_1',
          set: { email: 'ann@example.test' },
        })
      )._unsafeUnwrap(),
    ).toBe(1)
    expect(b.received).toHaveLength(received)
    expect(await countRows(local, '_replica_update')).toBe(1)
  })

  it('loads a region nobody holds for the write, then unloads it after the idle time and releases its database', async () => {
    const { counts, databases } = counting()
    const { hub, clock, local, a } = await hubWithHistory(['Ann'], { databases })

    hub.unsubscribe(region.id, a.id)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)

    expect((await hub.writeRecord(region, emailWrite))._unsafeUnwrap()).toBe(2)
    expect(hub.loadedRegions()).toBe(1)
    expect(await storedEmail(local, 'prf_1')).toBe(newEmail)

    await clock.advance(60_000)

    expect(hub.loadedRegions()).toBe(0)
    expect(counts).toEqual({ acquired: 2, released: 2 })
    expect(profileIn(snapshotIn(await subscribed(hub)))).toMatchObject({ email: newEmail })
  })

  it('keeps the region it writes when the unload of the region waits in its queue', async () => {
    const held = gate()
    let holding = false
    const { counts, databases } = counting()
    const { hub, clock, a } = await hubWithHistory(['Ann'], {
      databases,
      intercept: (text) => (holding && text === acceptStatement ? held.opened : undefined),
    })

    // The device's last batch is stored meanwhile; it leaves, and the unload comes due behind it.
    holding = true
    const pushed = hub.push(region.id, a, 2, [editFrom(a.doc, 'Ana')])

    await drain()
    holding = false
    hub.unsubscribe(region.id, a.id)
    await clock.advance(60_000)
    const written = hub.writeRecord(region, emailWrite)

    held.open()
    ;(await pushed)._unsafeUnwrap()

    expect((await written)._unsafeUnwrap()).toBe(3)
    expect(hub.loadedRegions()).toBe(1)
    expect(counts).toEqual({ acquired: 1, released: 0 })

    await clock.advance(60_000)

    expect(hub.loadedRegions()).toBe(0)
    expect(counts).toEqual({ acquired: 1, released: 1 })
  })

  it('refuses a date that names no time as a value, logging and sending nothing, and takes the next write', async () => {
    const { hub, local } = await openHub()
    const acme = { kind: 'tenant', id: 'tenant:acme' } as const
    const ann = subscriber('ann')
    const bob = subscriber('bob')
    const id = noteIdFactory.create()
    const at = new Date('2026-11-02T10:00:00.000Z')

    ;(await hub.subscribe(acme, memberOf('idn_ann'), ann, null))._unsafeUnwrap()
    ;(await hub.subscribe(acme, memberOf('idn_bob'), bob, null))._unsafeUnwrap()
    ;(
      await hub.push(acme.id, ann, 1, [
        noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' }),
      ])
    )._unsafeUnwrap()
    const received = bob.received.length

    const refused = await hub.writeRecord(acme, {
      table: 'note',
      id,
      set: { created_at: new Date(Number.NaN) },
    })

    expect(refused._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: 'note.created_at is set to a date that names no time',
    })
    expect(bob.received).toHaveLength(received)
    expect(await countRows(local, '_replica_update')).toBe(1)

    expect(
      (await hub.writeRecord(acme, { table: 'note', id, set: { created_at: at } }))._unsafeUnwrap(),
    ).toBe(2)
    expect(bob.received.at(-1)).toMatchObject({ type: 'updates', head: 2 })
    expect(bob.doc.getMap('records').toJSON()).toMatchObject({
      [`note/${id}`]: { created_at: '2026-11-02T10:00:00.000Z' },
    })
  })

  it("continues the server's peer across the region's unload: a write after the reload reaches a device as an update it imports", async () => {
    const { hub, clock, a } = await hubWithHistory(['Ann'])

    expect((await hub.writeRecord(region, emailWrite))._unsafeUnwrap()).toBe(2)

    hub.unsubscribe(region.id, a.id)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)

    const later = { ...emailWrite, set: { email: 'ann@later.example.test' } }

    expect((await hub.writeRecord(region, later))._unsafeUnwrap()).toBe(3)
    ;(await hub.subscribe(region, actor, a, a.doc.version().encode()))._unsafeUnwrap()

    expect(a.received.at(-1)).toMatchObject({ type: 'updates', head: 3, snapshot: false })
    expect(profileIn(a.doc)?.['email']).toBe('ann@later.example.test')
    // Each write set one field: the second took the counter after the first's.
    expect(a.doc.version().toJSON().get(SERVER_PEER)).toBe(2)
    expect(profileIn(snapshotIn(await subscribed(hub)))?.['email']).toBe('ann@later.example.test')
  })

  it("continues the server's peer across a compaction and the reload from its snapshot", async () => {
    const { hub, clock, local, a } = await hubWithHistory(['Ann'])

    ;(await hub.writeRecord(region, emailWrite))._unsafeUnwrap()
    ;(await hub.compact(region.id, a, 2, snapshotOf(a.doc)))._unsafeUnwrap()
    expect(a.received.at(-1)).toMatchObject({ type: 'compaction', covers: 2, outcome: 'accepted' })

    const second = { ...emailWrite, set: { email: 'ann@second.example.test' } }
    const third = { ...emailWrite, set: { email: 'ann@third.example.test' } }

    expect((await hub.writeRecord(region, second))._unsafeUnwrap()).toBe(3)
    hub.unsubscribe(region.id, a.id)
    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)
    expect((await hub.writeRecord(region, third))._unsafeUnwrap()).toBe(4)
    ;(await hub.subscribe(region, actor, a, a.doc.version().encode()))._unsafeUnwrap()

    expect(a.received.at(-1)).toMatchObject({ type: 'updates', head: 4, snapshot: false })
    expect(profileIn(a.doc)?.['email']).toBe('ann@third.example.test')
    expect(a.doc.version().toJSON().get(SERVER_PEER)).toBe(3)
    expect(await storedEmail(local, 'prf_1')).toBe('ann@third.example.test')
    expect(profileIn(snapshotIn(await subscribed(hub)))?.['email']).toBe('ann@third.example.test')
  })

  it('fails a write once the hub is closed, holding nothing', async () => {
    const { counts, databases } = counting()
    const { hub } = await openHub({ databases })

    await hub.close()

    expect((await hub.writeRecord(region, emailWrite))._unsafeUnwrapErr().code).toBe(
      'data:WRITE_FAILED',
    )
    expect(hub.loadedRegions()).toBe(0)
    expect(counts.acquired).toBe(0)
  })
})

let freshDevices = 0

/** A device of the owner newly subscribed to the region, with the full snapshot it was answered. */
async function subscribed(hub: RegionHub) {
  freshDevices += 1

  const device = subscriber(`fresh-${freshDevices}`)

  ;(await hub.subscribe(region, actor, device, null))._unsafeUnwrap()

  return device
}
