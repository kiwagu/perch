import { LoroDoc, LoroMap } from 'loro-crdt'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import type { ClientMessage, ServerMessage } from '../protocol'
import { RegionDoc } from '../region-doc'
import { manualClock } from '../testing/manual-clock'

import {
  closeDevices,
  profileKey,
  regionId,
  twoDevices,
  writeBio,
  writeName,
} from './__fixtures__/devices'
import { RegionSync } from './region-sync'
import type { SyncTransport } from './transport'

const databases: LocalDb[] = []

afterEach(async () => {
  for (const local of databases.splice(0)) {
    await local.close()
  }

  expect(await closeDevices()).toEqual([])
})

/** A region's sync over a transport that is always up and keeps what was sent. */
async function alone(options: { readonly persisted?: boolean } = {}) {
  const clock = manualClock()
  const sent: ClientMessage[] = []
  const errors: DataError[] = []
  const transport: SyncTransport = {
    start() {},
    stop() {},
    send(message) {
      sent.push(message)

      return true
    },
    onMessage: () => () => {},
    onChannel: () => () => {},
    onEnded: () => () => {},
  }
  let region = RegionDoc.inMemory('private', regionId)

  if (options.persisted) {
    const local = (await openTestDb())._unsafeUnwrap()

    databases.push(local)
    region = (await RegionDoc.open(local, { kind: 'private', id: regionId }))._unsafeUnwrap()
  }

  const sync = new RegionSync({
    region,
    transport,
    clock,
    actor: regionId,
    onSettled: () => {},
    onError: (error) => errors.push(error),
  })
  const count = (type: ClientMessage['type']) =>
    sent.filter((message) => message.type === type).length

  return { clock, errors, region, sync, count }
}

/** Server updates of the profile: a later one that needs an earlier one, and all of it. */
function serverHistory() {
  const author = new LoroDoc()

  author.getMap('records').setContainer(profileKey, new LoroMap()).set('name', 'Ann')
  author.commit()

  const first = author.version()

  ;(author.getMap('records').get(profileKey) as LoroMap).set('name', 'Ana')
  author.commit()

  return {
    gap: new Uint8Array(author.export({ mode: 'update', from: first })),
    all: new Uint8Array(author.export({ mode: 'update' })),
  }
}

function updates(bytes: Uint8Array<ArrayBuffer>, head: number, snapshot = false): ServerMessage {
  return { type: 'updates', region: regionId, bytes, head, snapshot }
}

const emptyRegion = new Uint8Array(new LoroDoc().export({ mode: 'snapshot' }))

const notSubscribed: ServerMessage = {
  type: 'error',
  code: 'protocol',
  message: `not subscribed to region ${regionId}`,
}

describe('region sync on its own', () => {
  it('repeats an outstanding pull on every full pass until an import completes', async () => {
    const { sync, count, errors } = await alone()
    const { gap, all } = serverHistory()

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))
    await sync.handle(updates(gap, 2))

    expect(count('pull')).toBe(1)

    sync.retryPull()

    expect(count('pull')).toBe(1)

    // The pull is refused: it is no longer out, and the region keeps syncing.
    await sync.handle(notSubscribed)

    expect(sync.quiet()).toBe(true)
    expect(sync.stopped()).toBe(false)

    sync.retryPull()

    expect(count('pull')).toBe(2)

    await sync.handle(updates(all, 2))
    sync.retryPull()

    expect(count('pull')).toBe(2)
    expect(errors).toEqual([])
  })

  it('gives up on a pull whose answer never comes after 30 seconds, and reports it once', async () => {
    const { sync, count, errors, clock } = await alone()

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))
    await sync.handle(updates(serverHistory().gap, 2))
    await clock.advance(29_999)

    expect(sync.quiet()).toBe(false)

    await clock.advance(1)

    expect(sync.quiet()).toBe(true)
    expect(errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])

    sync.retryPull()

    expect(count('pull')).toBe(2)
  })

  it('subscribes again when the gateway failed the subscription', async () => {
    const { sync, count } = await alone()

    sync.subscribe()
    await sync.handle({ type: 'error', code: 'internal', message: 'the region did not load' })

    expect(sync.quiet()).toBe(false)

    // What a full pass and every push ask for.
    sync.resubscribe()

    expect(count('subscribe')).toBe(2)

    await sync.handle(updates(emptyRegion, 0, true))
    sync.resubscribe()

    expect(count('subscribe')).toBe(2)
    expect(sync.quiet()).toBe(true)
  })

  it('releases a push the gateway answered with any error, keeping its batch', async () => {
    const { sync, count, region } = await alone({ persisted: true })

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))
    writeName(region, 'Ann')
    const pushed = sync.pushNext()

    await vi.waitFor(() => expect(count('push')).toBe(1))
    await sync.handle(notSubscribed)

    expect(await pushed).toBe('down')
    expect((await region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
    expect(sync.stopped()).toBe(false)
  })

  it('releases a push whose answer never comes after 30 seconds, and reports it once', async () => {
    const { sync, count, region, errors, clock } = await alone({ persisted: true })

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))
    writeName(region, 'Ann')
    const pushed = sync.pushNext()

    await vi.waitFor(() => expect(count('push')).toBe(1))
    await clock.advance(30_000)

    expect(await pushed).toBe('down')
    expect(errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])
    expect((await region.outbox(10))._unsafeUnwrap()).toHaveLength(1)
  })
})

describe('region sync through the gateway', () => {
  it('carries an edit from one device to the other', async () => {
    const { a, b, settle } = await twoDevices()

    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
    expect(b.region.pulled()).toBe(a.region.pulled())
  })

  it('keeps an offline edit and delivers it when the channel returns', async () => {
    const { a, b, settle } = await twoDevices()

    b.transport.goOffline()
    writeBio(b.region, 'offline words')
    b.engine.localWrite()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    b.transport.goOnline()
    await settle()

    expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Ana', bio: 'offline words' })
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana', bio: 'offline words' })
    expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('pulls when a pushed update skips a sequence number', async () => {
    const { a, b, stub, settle } = await twoDevices()

    // b misses the batch that names the profile Ana.
    stub.dropNextFanOutTo(b.transport)
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    writeName(a.region, 'Anna')
    a.engine.localWrite()
    await settle()

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Anna' })
    expect(b.region.pulled()).toBe(a.region.pulled())
  })

  it('rolls a rejected batch back with its inverse and gets the pair accepted', async () => {
    const { a, b, settle, stub } = await twoDevices()

    // A table outside the region.
    a.region.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    a.region.doc.commit()
    a.engine.localWrite()
    await settle()

    expect(a.region.recordJson('note/n_1')).toBeUndefined()
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(stub.rejections()).toBe(1)
    expect(b.region.recordJson('note/n_1')).toBeUndefined()
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })
  })

  it('brings back the text of a field a rejected batch deleted, without doubling it', async () => {
    const { a, b, settle } = await twoDevices()

    writeBio(a.region, 'kept words')
    a.engine.localWrite()
    await settle()
    // One batch deletes the text field and writes a table outside the region.
    a.region.recordMap(profileKey).delete('bio')
    a.region.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    a.region.doc.commit()
    a.engine.localWrite()
    await settle()

    expect(a.region.recordJson(profileKey)).toMatchObject({ bio: 'kept words' })
    expect(b.region.recordJson(profileKey)).toMatchObject({ bio: 'kept words' })
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('stops syncing a region whose rollback is rejected too, and reports it', async () => {
    const { a, settle, stub, errors } = await twoDevices()

    stub.rejectEverything()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(errors()).toEqual([expect.objectContaining({ code: 'data:SYNC_STOPPED' })])
    expect(stub.rejections()).toBe(2)
    expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })
  })

  it('proposes a compaction when asked and quiet', async () => {
    const { a, settle, stub } = await twoDevices({ compactionLogLimit: 1 })

    writeName(a.region, 'A')
    a.engine.localWrite()
    await settle()
    writeName(a.region, 'B')
    a.engine.localWrite()
    await settle()

    // The profile was created as the first batch; naming it A made the second.
    expect(stub.compactions()).toEqual([{ covers: 2, outcome: 'accepted' }])
  })
})
