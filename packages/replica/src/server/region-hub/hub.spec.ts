import { LoroDoc, type LoroMap } from 'loro-crdt'
import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { noteIdFactory } from '@workspace/ids'

import bumpHeadStatement from '../../__fixtures__/bump-head.surql'
import { noteCreate, noteUpdate } from '../../__fixtures__/note'
import {
  countRows,
  forgedHistory,
  nameIn,
  profileIn,
  storedEmail,
  storedProfile,
  storedSnapshot,
} from '../__fixtures__/log'
import type { RecordWrite } from '../record-write'
import { type RegionDatabases, singleDatabase } from '../region-databases'
import { RegionLog } from '../region-log'
import { SERVER_PEER } from '../server-peer'
import acceptStatement from '../surql/server-accept.surql'
import headsStatement from '../surql/server-heads.surql'
import loadStatement from '../surql/server-load.surql'

import {
  actor,
  closeHubs,
  editFrom,
  type HubFixtureOptions,
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
  type TestSubscriber,
  underPeerOf,
} from './__fixtures__/hub'
import type { RegionHub, Subscriber } from './hub'

afterEach(closeHubs)

/**
 * The fixture's database for every region, counting the holds taken on it and released. Once
 * `replace` names another database, every later hold is taken on that one, as when a region's
 * database was removed and made again.
 */
function counting() {
  const counts = { acquired: 0, released: 0 }
  let replacement: LocalDb | undefined
  const databases = (local: LocalDb): RegionDatabases => {
    const single = singleDatabase(local)

    return {
      databaseOf: (ref) => single.databaseOf(ref),
      acquire: (ref) => {
        counts.acquired += 1

        return single.acquire(ref).map((database) => ({
          local: replacement ?? database.local,
          release: () => {
            counts.released += 1
          },
        }))
      },
    }
  }
  const replace = (local: LocalDb) => {
    replacement = local
  }

  return { counts, databases, replace }
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

    // A forged edit of a field devices may change: one of `email` would be refused as read-only
    // before the peer check.
    ;(forger.getMap('records').get('profile/prf_1') as LoroMap).set('name', 'Eve')
    forger.commit()
    ;(await hub.push(region.id, a, 2, [forger.export({ mode: 'update', from })]))._unsafeUnwrap()

    expect(a.received.at(-1)).toMatchObject({ type: 'reject', batch: 2, reason: 'foreign-peer' })
    expect(b.received.filter((m) => m.type === 'updates' && m.head > 1)).toEqual([])
    expect(await countRows(local, '_replica_update')).toBe(1)
    expect(await storedProfile(local, 'prf_1')).toMatchObject({ name: 'Ann' })

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

describe('retiring a region', () => {
  const acme = { kind: 'tenant', id: 'tenant:acme' } as const

  it("drops the region's document: a subscription under the same id loads the region afresh from its database", async () => {
    const { counts, databases, replace } = counting()
    const { hub } = await openHub({ databases })
    const ann = subscriber('ann')
    const id = noteIdFactory.create()

    ;(await hub.subscribe(acme, memberOf('idn_ann'), ann, null))._unsafeUnwrap()
    ;(
      await hub.push(acme.id, ann, 1, [
        noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' }),
      ])
    )._unsafeUnwrap()
    expect(ann.received.at(-1)).toMatchObject({ type: 'ack', head: 1 })

    // The organisation goes: its device's connection ends, the region is retired, and the
    // organisation's database is made again for another one under the same key.
    hub.unsubscribe(acme.id, ann.id)
    expect((await hub.retire(acme.id)).isOk()).toBe(true)
    expect(hub.loadedRegions()).toBe(0)
    expect(counts).toEqual({ acquired: 1, released: 1 })
    replace(await openDatabase())

    const bob = subscriber('bob')

    ;(await hub.subscribe(acme, memberOf('idn_bob', 'admin'), bob, null))._unsafeUnwrap()

    expect(snapshotIn(bob).getMap('records').toJSON()).toEqual({})
    expect((await hub.heads([acme.id]))._unsafeUnwrap()).toEqual([{ region: acme.id, head: 0 }])
    expect(counts).toEqual({ acquired: 2, released: 1 })
  })

  it('settles the work asked before it first, as asked, then releases the database', async () => {
    const held = gate()
    let holding = false
    const { counts, databases } = counting()
    const { hub, clock, local, a, b } = await hubWithTwoSubscribers({
      databases,
      intercept: (text) => (holding && text === acceptStatement ? held.opened : undefined),
    })

    // A batch is stored meanwhile, and a write of the server's own waits behind it.
    holding = true
    const pushed = hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')])

    await drain()
    holding = false
    const written = hub.writeRecord(region, emailWrite)
    const retired = hub.retire(region.id)

    await drain()
    expect(counts).toEqual({ acquired: 1, released: 0 })

    held.open()
    ;(await pushed)._unsafeUnwrap()
    expect((await written)._unsafeUnwrap()).toBe(2)
    expect((await retired).isOk()).toBe(true)

    expect(a.received.filter((m) => m.type === 'ack')).toEqual([
      expect.objectContaining({ batch: 1, head: 1 }),
    ])
    expect(b.received.filter((m) => m.type === 'updates').map((m) => m.head)).toEqual([0, 1, 2])
    expect(await storedEmail(local, 'prf_1')).toBe(newEmail)
    expect(await countRows(local, '_replica_update')).toBe(2)
    expect(counts).toEqual({ acquired: 1, released: 1 })
    // Nothing is scheduled for the region it let go.
    expect(clock.pending()).toBe(0)
  })

  it('gives a subscription and a write asked while it waits the region afresh, never the retired document', async () => {
    const held = gate()
    let holding = false
    const { counts, databases, replace } = counting()
    const { hub, a } = await hubWithHistory(['Ann'], {
      databases,
      intercept: (text) => (holding && text === acceptStatement ? held.opened : undefined),
    })

    holding = true
    const pushed = hub.push(region.id, a, 2, [setFrom(a.doc, 'name', 'Ana')])

    await drain()
    holding = false
    const retired = hub.retire(region.id)

    replace(await openDatabase())
    const fresh = subscriber('fresh')
    const joined = hub.subscribe(region, actor, fresh, null)
    const written = hub.writeRecord(region, emailWrite)

    await drain()
    // Both wait for the retire, which waits for the batch under way.
    expect(fresh.received).toEqual([])
    expect(counts).toEqual({ acquired: 1, released: 0 })

    held.open()
    ;(await pushed)._unsafeUnwrap()
    expect((await retired).isOk()).toBe(true)
    ;(await joined)._unsafeUnwrap()

    expect(a.received.at(-1)).toMatchObject({ type: 'ack', batch: 2, head: 2 })
    expect(fresh.received).toEqual([
      expect.objectContaining({ type: 'updates', head: 0, snapshot: true }),
    ])
    expect(snapshotIn(fresh).getMap('records').toJSON()).toEqual({})
    // The region the write found holds no profile.
    expect((await written)._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
    expect(counts).toEqual({ acquired: 2, released: 1 })
  })

  it('lets the region go at once: while it waits, the head is read from the database, not the retired log', async () => {
    const held = gate()
    let holding = false
    const { databases, replace } = counting()
    const { hub, a } = await hubWithHistory(['Ann'], {
      databases,
      intercept: (text) => (holding && text === acceptStatement ? held.opened : undefined),
    })

    holding = true
    const pushed = hub.push(region.id, a, 2, [setFrom(a.doc, 'name', 'Ana')])

    await drain()
    holding = false
    const retired = hub.retire(region.id)

    replace(await openDatabase())

    expect((await hub.heads([region.id]))._unsafeUnwrap()).toEqual([{ region: region.id, head: 0 }])
    expect(hub.loadedRegions()).toBe(0)

    held.open()
    ;(await pushed)._unsafeUnwrap()
    expect((await retired).isOk()).toBe(true)
  })

  it('drops the devices still subscribed: they are sent nothing of the region afterwards, and refused as not subscribed', async () => {
    const { hub, local, a, b } = await hubWithTwoSubscribers()

    ;(await hub.push(region.id, a, 1, [editFrom(a.doc, 'Ann')]))._unsafeUnwrap()
    ;(await hub.retire(region.id))._unsafeUnwrap()
    const received = b.received.length

    ;(await hub.push(region.id, a, 2, [setFrom(a.doc, 'name', 'Ana')]))._unsafeUnwrap()
    ;(await hub.pull(region.id, b, b.doc.version().encode()))._unsafeUnwrap()
    ;(await hub.writeRecord(region, emailWrite))._unsafeUnwrap()

    expect(a.received.at(-1)).toMatchObject({ type: 'error', code: 'protocol' })
    expect(b.received.slice(received)).toEqual([
      expect.objectContaining({ type: 'error', code: 'protocol' }),
    ])
    expect(await countRows(local, '_replica_update')).toBe(2)
  })

  it('leaves a region it does not hold as it is, and a region retired already', async () => {
    const { counts, databases } = counting()
    const { hub } = await openHub({ databases })

    expect((await hub.retire(region.id)).isOk()).toBe(true)
    expect(counts).toEqual({ acquired: 0, released: 0 })

    ;(await hub.subscribe(region, actor, subscriber('a'), null))._unsafeUnwrap()

    expect((await hub.retire(region.id)).isOk()).toBe(true)
    expect((await hub.retire(region.id)).isOk()).toBe(true)
    expect(counts).toEqual({ acquired: 1, released: 1 })
    expect(hub.loadedRegions()).toBe(0)
  })

  it('cancels the unload scheduled when the last device left: the database is released once', async () => {
    const { counts, databases } = counting()
    const { hub, clock, a } = await hubWithHistory(['Ann'], { databases })

    hub.unsubscribe(region.id, a.id)
    expect(clock.pending()).toBe(1)

    ;(await hub.retire(region.id))._unsafeUnwrap()

    expect(clock.pending()).toBe(0)
    await clock.advance(60_000)
    expect(counts).toEqual({ acquired: 1, released: 1 })
  })

  it('releases the database once when the unload already waits in the queue, and keeps the region held afresh', async () => {
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
    const retired = hub.retire(region.id)
    const fresh = subscriber('fresh')
    const joined = hub.subscribe(region, actor, fresh, null)

    held.open()
    ;(await pushed)._unsafeUnwrap()
    expect((await retired).isOk()).toBe(true)
    ;(await joined)._unsafeUnwrap()
    await drain()

    expect(counts).toEqual({ acquired: 2, released: 1 })
    expect(hub.loadedRegions()).toBe(1)
    ;(await hub.push(region.id, fresh, 1, [setFrom(fresh.doc, 'name', 'Anna')]))._unsafeUnwrap()
    expect(fresh.received.at(-1)).toMatchObject({ type: 'ack', batch: 1, head: 3 })
  })

  it('schedules no unload of the region once retired, when a write asked before it settles', async () => {
    const { counts, databases } = counting()
    const { hub, clock, a } = await hubWithHistory(['Ann'], { databases })

    // Only the write holds the region when the retire is asked.
    hub.unsubscribe(region.id, a.id)
    const written = hub.writeRecord(region, emailWrite)
    const retired = hub.retire(region.id)

    expect((await written)._unsafeUnwrap()).toBe(2)
    expect((await retired).isOk()).toBe(true)
    await drain()

    expect(clock.pending()).toBe(0)
    expect(counts).toEqual({ acquired: 1, released: 1 })
  })

  it('fails as a data error when the database is not released, and lets the region go all the same', async () => {
    const { hub } = await openHub({
      databases: (local) => ({
        databaseOf: () => 'single',
        acquire: () =>
          okAsync({
            local,
            release: () => {
              throw new Error('the database went away')
            },
          }),
      }),
    })

    ;(await hub.subscribe(region, actor, subscriber('a'), null))._unsafeUnwrap()

    expect((await hub.retire(region.id))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    expect(hub.loadedRegions()).toBe(0)
  })

  it('is waited for by the close: the database is released before the hub closes', async () => {
    const held = gate()
    let holding = false
    const { counts, databases } = counting()
    const { hub, a } = await hubWithHistory(['Ann'], {
      databases,
      intercept: (text) => (holding && text === acceptStatement ? held.opened : undefined),
    })

    holding = true
    const pushed = hub.push(region.id, a, 2, [editFrom(a.doc, 'Ana')])

    await drain()
    holding = false
    const retired = hub.retire(region.id)
    let releasedAtClose: number | undefined
    const closed = hub.close().then(() => {
      releasedAtClose = counts.released
    })

    held.open()
    await closed
    ;(await pushed)._unsafeUnwrap()

    expect((await retired).isOk()).toBe(true)
    expect(releasedAtClose).toBe(1)
  })
})

describe('changing the actor of a subscriber', () => {
  const acme = { kind: 'tenant', id: 'tenant:acme' } as const

  /** The acknowledgements and rejections a device was answered with, in order. */
  const answers = (device: TestSubscriber) =>
    device.received.filter((message) => message.type === 'ack' || message.type === 'reject')

  /**
   * An update that rewrites the note `id` as a device holding what `device` holds, on a document
   * of its own: it stands on no change of an earlier batch of the device, accepted or not.
   */
  function editOf(device: TestSubscriber, id: string, text: string): Uint8Array {
    const doc = new LoroDoc()

    doc.import(snapshotOf(device.doc))

    return noteUpdate(doc, { id, text })
  }

  /** The hub holds acme with a note ann wrote as a member, and ann subscribed. */
  async function acmeWithNote(options: HubFixtureOptions = {}) {
    const fixture = await openHub(options)
    const ann = subscriber('ann')
    const id = noteIdFactory.create()

    ;(await fixture.hub.subscribe(acme, memberOf('idn_ann'), ann, null))._unsafeUnwrap()
    ;(
      await fixture.hub.push(acme.id, ann, 1, [
        noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' }),
      ])
    )._unsafeUnwrap()

    return { ...fixture, ann, id }
  }

  /**
   * Acme's queue held inside a batch of ann's until `open()`: whatever is asked of the region
   * meanwhile waits behind it. `ahead()` asks for that batch and answers, once the batch reached
   * its held statement, with the promise of its outcome.
   */
  function holdingAnnsBatch() {
    const held = gate()
    const reached = gate()
    let holding = false
    const options: HubFixtureOptions = {
      intercept: (text) => {
        if (!holding || text !== acceptStatement) {
          return undefined
        }

        // Only the first batch to get there is held.
        holding = false
        reached.open()

        return held.opened
      },
    }
    const ahead = async (hub: RegionHub, ann: TestSubscriber) => {
      holding = true

      const pushed = hub.push(acme.id, ann, 2, [
        noteCreate(ann.doc, { id: noteIdFactory.create(), author: 'idn_ann', text: 'more' }),
      ])

      await reached.opened

      return { pushed }
    }

    return { options, ahead, open: held.open }
  }

  it("judges a subscriber's next batch by its new actor: an admin's edit of another's note is acknowledged, a member's again refused", async () => {
    const { hub, id } = await acmeWithNote()
    const bob = subscriber('bob')

    ;(await hub.subscribe(acme, memberOf('idn_bob'), bob, null))._unsafeUnwrap()
    ;(await hub.push(acme.id, bob, 1, [editOf(bob, id, 'as a member')]))._unsafeUnwrap()

    hub.changeActor(acme.id, bob.id, memberOf('idn_bob', 'admin'))
    ;(await hub.push(acme.id, bob, 2, [editOf(bob, id, 'as an admin')]))._unsafeUnwrap()

    hub.changeActor(acme.id, bob.id, memberOf('idn_bob'))
    ;(await hub.push(acme.id, bob, 3, [editOf(bob, id, 'a member again')]))._unsafeUnwrap()

    expect(answers(bob)).toEqual([
      expect.objectContaining({ type: 'reject', batch: 1, reason: 'forbidden-action' }),
      expect.objectContaining({ type: 'ack', batch: 2 }),
      expect.objectContaining({ type: 'reject', batch: 3, reason: 'forbidden-action' }),
    ])
  })

  it('changes only the subscriber it names: another device of the region keeps its actor', async () => {
    const { hub, id } = await acmeWithNote()
    const bob = subscriber('bob')
    const cat = subscriber('cat')

    ;(await hub.subscribe(acme, memberOf('idn_bob'), bob, null))._unsafeUnwrap()
    ;(await hub.subscribe(acme, memberOf('idn_cat'), cat, null))._unsafeUnwrap()

    hub.changeActor(acme.id, bob.id, memberOf('idn_bob', 'admin'))
    ;(await hub.push(acme.id, bob, 1, [editOf(bob, id, 'as an admin')]))._unsafeUnwrap()
    ;(await hub.push(acme.id, cat, 1, [editOf(cat, id, 'as a member')]))._unsafeUnwrap()

    expect(answers(bob)).toEqual([expect.objectContaining({ type: 'ack', batch: 1 })])
    expect(answers(cat)).toEqual([
      expect.objectContaining({ type: 'reject', batch: 1, reason: 'forbidden-action' }),
    ])
  })

  it('answers a subscription that waits in the queue into the actor it was swapped to meanwhile', async () => {
    const queue = holdingAnnsBatch()
    const { hub, ann, id } = await acmeWithNote(queue.options)
    const bob = subscriber('bob')
    const { pushed: annsBatch } = await queue.ahead(hub, ann)
    const joining = hub.subscribe(acme, memberOf('idn_bob'), bob, null)

    await drain()
    hub.changeActor(acme.id, bob.id, memberOf('idn_bob', 'admin'))
    queue.open()
    ;(await annsBatch)._unsafeUnwrap()
    ;(await joining)._unsafeUnwrap()
    ;(await hub.push(acme.id, bob, 1, [editOf(bob, id, 'as an admin')]))._unsafeUnwrap()

    expect(answers(bob)).toEqual([expect.objectContaining({ type: 'ack', batch: 1 })])
  })

  it('answers a subscription that waits in the queue into the actor it was swapped back to', async () => {
    const queue = holdingAnnsBatch()
    const { hub, ann, id } = await acmeWithNote(queue.options)
    const bob = subscriber('bob')
    const { pushed: annsBatch } = await queue.ahead(hub, ann)
    const joining = hub.subscribe(acme, memberOf('idn_bob', 'admin'), bob, null)

    await drain()
    hub.changeActor(acme.id, bob.id, memberOf('idn_bob'))
    queue.open()
    ;(await annsBatch)._unsafeUnwrap()
    ;(await joining)._unsafeUnwrap()
    ;(await hub.push(acme.id, bob, 1, [editOf(bob, id, 'as a member')]))._unsafeUnwrap()

    expect(answers(bob)).toEqual([
      expect.objectContaining({ type: 'reject', batch: 1, reason: 'forbidden-action' }),
    ])
  })

  it('judges a batch already queued in the region by the actor the hub holds when it takes the batch in', async () => {
    const queue = holdingAnnsBatch()
    const { hub, ann, id } = await acmeWithNote(queue.options)
    const bob = subscriber('bob')

    ;(await hub.subscribe(acme, memberOf('idn_bob', 'admin'), bob, null))._unsafeUnwrap()

    const { pushed: annsBatch } = await queue.ahead(hub, ann)
    const bobsBatch = hub.push(acme.id, bob, 1, [editOf(bob, id, 'queued as an admin')])

    await drain()
    hub.changeActor(acme.id, bob.id, memberOf('idn_bob'))
    queue.open()
    ;(await annsBatch)._unsafeUnwrap()
    ;(await bobsBatch)._unsafeUnwrap()

    expect(answers(bob)).toEqual([
      expect.objectContaining({ type: 'reject', batch: 1, reason: 'forbidden-action' }),
    ])
  })

  it('installs nothing for a subscriber that left while its subscription waited, a swap after it included', async () => {
    const queue = holdingAnnsBatch()
    const { hub, ann } = await acmeWithNote(queue.options)
    const bob = subscriber('bob')
    const { pushed: annsBatch } = await queue.ahead(hub, ann)
    const joining = hub.subscribe(acme, memberOf('idn_bob'), bob, null)

    await drain()
    hub.unsubscribe(acme.id, bob.id)
    hub.changeActor(acme.id, bob.id, memberOf('idn_bob', 'admin'))
    queue.open()
    ;(await annsBatch)._unsafeUnwrap()
    ;(await joining)._unsafeUnwrap()
    ;(await hub.push(acme.id, bob, 1, []))._unsafeUnwrap()

    expect(bob.received).toEqual([expect.objectContaining({ type: 'error', code: 'protocol' })])
  })

  it('changes nothing for a region the hub does not hold, nor for a device that has not subscribed to it', async () => {
    const { hub, id } = await acmeWithNote()
    const ghost = subscriber('ghost')

    hub.changeActor('tenant:elsewhere', ghost.id, memberOf('idn_ghost', 'admin'))
    hub.changeActor(acme.id, ghost.id, memberOf('idn_ghost', 'admin'))

    expect(hub.loadedRegions()).toBe(1)
    ;(await hub.push(acme.id, ghost, 1, []))._unsafeUnwrap()
    expect(ghost.received).toEqual([expect.objectContaining({ type: 'error', code: 'protocol' })])

    // The swap left no actor behind for a later subscription of the device.
    ;(await hub.subscribe(acme, memberOf('idn_ghost'), ghost, null))._unsafeUnwrap()
    ;(await hub.push(acme.id, ghost, 2, [editOf(ghost, id, 'as a member')]))._unsafeUnwrap()

    expect(answers(ghost)).toEqual([
      expect.objectContaining({ type: 'reject', batch: 2, reason: 'forbidden-action' }),
    ])
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
