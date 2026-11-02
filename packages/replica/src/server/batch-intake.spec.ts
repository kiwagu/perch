import type { LoroDoc } from 'loro-crdt'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { noteIdFactory } from '@workspace/ids'

import { noteCreate, noteUpdate, replicaSchema } from '../__fixtures__/note'
import { recordKey } from '../keys'
import type { ServerMessage } from '../protocol'

import { memberOf, subscriber, type TestSubscriber, underPeerOf } from './__fixtures__/hub'
import { type BatchIntake, takeInBatch } from './batch-intake'
import type { Loaded, RegionState } from './held-regions'
import { RegionLog } from './region-log'
import { deliver } from './subscription'

const regionId = 'tenant:acme'

let local: LocalDb
let loaded: Loaded
let state: RegionState
let errors: DataError[]
let intake: BatchIntake

beforeEach(async () => {
  local = (await openTestDb())._unsafeUnwrap()

  const { log, doc } = (await RegionLog.load(local, regionId))._unsafeUnwrap()

  loaded = { log, doc, database: { local, release: () => {} } }
  state = {
    ref: { kind: 'tenant', id: regionId },
    subscribers: new Map(),
    joining: new Map(),
    writes: 0,
    queue: Promise.resolve(),
    loaded,
    unload: undefined,
  }
  errors = []
  // As the hub sends: a device whose import throws is recorded, not thrown.
  intake = {
    schema: replicaSchema,
    compactionLogLimit: 200,
    send: (device, message) => deliver(device, message, (error) => errors.push(error)),
  }
})

afterEach(async () => {
  await local.close()
})

/** A member's device subscribed to the region: it receives the batches the others push. */
function join(identity: string): TestSubscriber {
  const device = subscriber(identity)

  state.subscribers.set(device.id, { subscriber: device, actor: memberOf(identity) })

  return device
}

/** Has `device` push `updates` as batch `batch`, as the hub runs it in the region's queue. */
async function push(
  device: TestSubscriber,
  batch: number,
  updates: readonly Uint8Array[],
): Promise<void> {
  const actor = state.subscribers.get(device.id)?.actor

  if (!actor) {
    throw new Error(`${device.id} has not joined the region`)
  }

  ;(
    await takeInBatch(
      intake,
      { regionId, subscriber: device, batch, updates },
      state,
      loaded,
      actor,
    )
  )._unsafeUnwrap()
}

/** The last ack or reject the device received. */
function lastAnswer(device: TestSubscriber): ServerMessage | undefined {
  return device.received.findLast((m) => m.type === 'ack' || m.type === 'reject')
}

/** The text of note `id` as the document holds it. */
function textOf(doc: LoroDoc, id: string): unknown {
  const records = doc.getMap('records').toJSON() as Record<string, Record<string, unknown>>

  return records[recordKey('note', id)]?.['text']
}

describe('batch intake', () => {
  it("acknowledges a batch under the next head, imports it and sends it to the region's other subscribers", async () => {
    const ann = join('idn_ann')
    const bob = join('idn_bob')
    const id = noteIdFactory.create()

    await push(ann, 1, [noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' })])

    expect(lastAnswer(ann)).toMatchObject({ type: 'ack', batch: 1, head: 1 })
    expect(textOf(loaded.doc, id)).toBe('hello')
    expect(textOf(bob.doc, id)).toBe('hello')
    expect(ann.received.filter((m) => m.type === 'updates')).toEqual([])
  })

  it('acknowledges, under the current head and without a log row, a batch that brings only changes the region holds, whoever pushes it', async () => {
    const ann = join('idn_ann')
    const bob = join('idn_bob')
    const created = noteCreate(ann.doc, {
      id: noteIdFactory.create(),
      author: 'idn_ann',
      text: 'a',
    })

    await push(ann, 1, [created])
    await push(bob, 1, [created])

    expect(lastAnswer(bob)).toMatchObject({ type: 'ack', batch: 1, head: 1 })
    expect(loaded.log.head()).toBe(1)
  })

  it('acknowledges the next batch of a member whose Loro peer another member wrote under, and sends it to the others', async () => {
    const ann = join('idn_ann')
    const bob = join('idn_bob')
    const id = noteIdFactory.create()

    await push(ann, 1, [noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' })])

    // Ann edits her note and keeps the change; bob writes a note of his own as ann's peer,
    // so his change takes the counters her edit took.
    const edit = noteUpdate(ann.doc, { id, text: 'hello, edited' })
    const borrowed = underPeerOf(ann.doc, bob.doc)

    await push(bob, 1, [
      noteCreate(borrowed, { id: noteIdFactory.create(), author: 'idn_bob', text: 'mine' }),
    ])
    await push(ann, 2, [edit])

    expect(lastAnswer(ann)).toMatchObject({ type: 'ack', batch: 2 })
    expect(textOf(loaded.doc, id)).toBe('hello, edited')
    expect(textOf(bob.doc, id)).toBe('hello, edited')
  })

  it("rejects as foreign-peer a batch that brings changes under a peer another identity's batch was accepted under: nothing stored, imported or sent", async () => {
    const ann = join('idn_ann')
    const bob = join('idn_bob')
    const id = noteIdFactory.create()

    await push(ann, 1, [noteCreate(ann.doc, { id, author: 'idn_ann', text: 'hello' })])

    const version = loaded.doc.version()
    const borrowed = underPeerOf(ann.doc, bob.doc)

    await push(bob, 1, [
      noteCreate(borrowed, { id: noteIdFactory.create(), author: 'idn_bob', text: 'mine' }),
    ])

    expect(lastAnswer(bob)).toMatchObject({ type: 'reject', batch: 1, reason: 'foreign-peer' })
    expect(lastAnswer(bob)).toHaveProperty(
      'detail',
      expect.stringMatching(/^peer: \d+ writes as another identity in tenant:acme$/),
    )
    expect(loaded.log.head()).toBe(1)
    expect(loaded.doc.version().compare(version)).toBe(0)
    expect(ann.received.filter((m) => m.type === 'updates')).toEqual([])
  })
})
