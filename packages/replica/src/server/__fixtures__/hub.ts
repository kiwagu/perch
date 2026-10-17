import { LoroDoc, LoroMap, type VersionVector } from 'loro-crdt'

import type { DataError, LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'

import { profileSchema } from '../../__fixtures__/profile'
import type { ServerMessage } from '../../protocol'
import type { RegionRef } from '../../region-doc'
import { type ManualClock, manualClock } from '../../testing/manual-clock'
import { RegionHub, type Subscriber } from '../region-hub'

import { nameIn } from './log'

export const owner = 'identity:idn_a'

export const region: RegionRef = { kind: 'private', id: owner }

/** A device's end of a subscription: what it received, and its copy of the region's document. */
export interface TestSubscriber extends Subscriber {
  readonly received: ServerMessage[]
  readonly doc: LoroDoc
}

export interface HubFixture {
  readonly hub: RegionHub
  readonly clock: ManualClock
  readonly local: LocalDb
  /** What the hub reported through `onError`. */
  readonly errors: DataError[]
}

export interface HubFixtureOptions {
  readonly compactionLogLimit?: number
  /** Runs before every query the hub sends: it may hold the query or fail it. */
  readonly intercept?: (text: string) => void | Promise<void>
}

/** The version of each subscriber's document right after it last imported what the hub sent. */
const imported = new WeakMap<LoroDoc, VersionVector>()

const opened: HubFixture[] = []

/** A subscriber whose document imports every `updates` message it receives. */
export function subscriber(id: string): TestSubscriber {
  const doc = new LoroDoc()
  const received: ServerMessage[] = []

  imported.set(doc, doc.version())

  return {
    id,
    received,
    doc,
    send(message) {
      received.push(message)

      if (message.type === 'updates') {
        doc.import(message.bytes)
        imported.set(doc, doc.version())
      }
    },
  }
}

/**
 * Names the profile in a subscriber's document, creating it for `identity` (the owner by
 * default) when it is missing, and exports every change made since the document last
 * imported from the hub, as a device's outbox would push them.
 */
export function editFrom(doc: LoroDoc, name: string, identity: string = owner): Uint8Array {
  const from = imported.get(doc)

  if (!from) {
    throw new Error('the document does not belong to a test subscriber')
  }

  const record = doc.getMap('records').getOrCreateContainer('profile/prf_1', new LoroMap())

  record.set('identity', identity)
  record.set('email', 'ann@example.test')
  record.set('name', name)
  doc.commit()

  return doc.export({ mode: 'update', from })
}

export function snapshotOf(doc: LoroDoc): Uint8Array {
  return doc.export({ mode: 'snapshot' })
}

/** The document the last full snapshot the subscriber received holds. */
export function snapshotIn(device: TestSubscriber): LoroDoc {
  const snapshot = device.received.findLast((m) => m.type === 'updates' && m.snapshot)

  if (snapshot?.type !== 'updates') {
    throw new Error(`${device.id} received no snapshot`)
  }

  const doc = new LoroDoc()

  doc.import(snapshot.bytes)

  return doc
}

/** The profile's name in the last full snapshot the subscriber received. */
export function nameInSnapshot(device: TestSubscriber): unknown {
  return nameIn(snapshotIn(device))
}

/** A hub of the profile schema on a fresh embedded database, with a manual clock. */
export async function openHub(options: HubFixtureOptions = {}): Promise<HubFixture> {
  const local = (await openTestDb())._unsafeUnwrap()
  const clock = manualClock()
  const errors: DataError[] = []
  const hub = new RegionHub({
    local: options.intercept ? interceptQueries(local, options.intercept) : local,
    schema: profileSchema,
    clock,
    onError: (error) => errors.push(error),
    ...(options.compactionLogLimit === undefined
      ? {}
      : { compactionLogLimit: options.compactionLogLimit }),
  })
  const fixture = { hub, clock, local, errors }

  opened.push(fixture)

  return fixture
}

/** Two devices of the owner subscribed to the owner's empty private region. */
export async function hubWithTwoSubscribers(options: HubFixtureOptions = {}) {
  const fixture = await openHub(options)
  const a = subscriber('a')
  const b = subscriber('b')

  for (const device of [a, b]) {
    ;(await fixture.hub.subscribe(region, owner, device, null))._unsafeUnwrap()
  }

  return { ...fixture, a, b }
}

/**
 * A region whose device `a` pushed one batch per name, in order; `doc` is that device's
 * document, which holds the whole history, and `fresh` a device that has not subscribed yet.
 */
export async function hubWithHistory(names: readonly string[], options: HubFixtureOptions = {}) {
  const fixture = await openHub(options)
  const a = subscriber('a')

  ;(await fixture.hub.subscribe(region, owner, a, null))._unsafeUnwrap()

  for (const [index, name] of names.entries()) {
    ;(await fixture.hub.push(region.id, a, index + 1, [editFrom(a.doc, name)]))._unsafeUnwrap()
  }

  return { ...fixture, a, doc: a.doc, fresh: subscriber('fresh') }
}

/** Closes every hub opened since the last call, then its database. */
export async function closeHubs(): Promise<void> {
  for (const { hub, local } of opened.splice(0)) {
    await hub.close()
    await local.close()
  }
}
