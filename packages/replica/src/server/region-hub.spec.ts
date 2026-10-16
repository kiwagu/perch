import { afterEach, describe, expect, it } from 'vitest'

import {
  closeHubs,
  editFrom,
  hubWithHistory,
  hubWithTwoSubscribers,
  nameInSnapshot,
  openHub,
  owner,
  region,
  snapshotOf,
  subscriber,
} from './__fixtures__/hub'
import { countRows, nameIn } from './__fixtures__/log'
import acceptStatement from './surql/server-accept.surql'
import loadStatement from './surql/server-load.surql'

afterEach(closeHubs)

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

    expect((await hub.subscribe(region, owner, fresh, null)).isOk()).toBe(true)

    expect(fresh.received).toContainEqual(
      expect.objectContaining({ type: 'updates', snapshot: true, head: 2 }),
    )
  })

  it('answers a subscription or a pull with a version with only what the device lacks', async () => {
    const { hub, a, fresh } = await hubWithHistory(['Ann'])

    fresh.doc.import(snapshotOf(a.doc))
    const known = fresh.doc.version().encode()

    expect((await hub.push(region.id, a, 2, [editFrom(a.doc, 'Ana')])).isOk()).toBe(true)
    expect((await hub.subscribe(region, owner, fresh, known)).isOk()).toBe(true)
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

  it('unloads a region nobody watches after the idle time and reloads it intact', async () => {
    const { hub, clock, a } = await hubWithHistory(['Ann', 'Ana'])

    hub.unsubscribe(region.id, a.id)

    await clock.advance(60_000)
    expect(hub.loadedRegions()).toBe(0)

    const again = subscriber('again')

    expect((await hub.subscribe(region, owner, again, null)).isOk()).toBe(true)
    expect(nameInSnapshot(again)).toBe('Ana')
  })

  it('keeps a region loaded when a device subscribes again before the idle time', async () => {
    const { hub, clock, a } = await hubWithHistory(['Ann'])

    hub.unsubscribe(region.id, a.id)
    await clock.advance(30_000)
    expect((await hub.subscribe(region, owner, subscriber('again'), null)).isOk()).toBe(true)

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
      hub.subscribe(region, owner, a, null),
      hub.subscribe(region, owner, b, null),
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
