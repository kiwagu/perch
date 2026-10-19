import { LoroDoc, LoroMap } from 'loro-crdt'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { type NoteId, noteIdFactory } from '@workspace/ids'

import { noteCreate, noteDelete, noteUpdate } from '../__fixtures__/note'
import { recordKey } from '../keys'
import { type ClientMessage, MAX_PUSH_UPDATES, type ServerMessage } from '../protocol'
import { RegionDoc } from '../region-doc'
import { replaceRegionDoc } from '../region-replacement'
import localTailStatement from '../surql/local-tail.surql'
import outboxReadStatement from '../surql/outbox-read.surql'
import importStatement from '../surql/replica-import.surql'
import type { GatewayStub } from '../testing/gateway-stub'
import { interceptRegionResets } from '../testing/intercept-region-resets'
import { manualClock } from '../testing/manual-clock'

import {
  ann,
  bob,
  closeDevices,
  openDevice,
  openGateway,
  profileKey,
  regionId,
  settleAll,
  twoDevices,
  twoMembers,
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
async function alone(
  options: {
    readonly persisted?: boolean
    readonly wrap?: (local: LocalDb) => LocalDb
    /** Hears each message as it is sent. */
    readonly onSend?: (message: ClientMessage) => void
  } = {},
) {
  const clock = manualClock()
  const sent: ClientMessage[] = []
  const errors: DataError[] = []
  const recycled = { count: 0 }
  const transport: SyncTransport = {
    start() {},
    stop() {},
    reconnect() {
      recycled.count += 1
    },
    send(message) {
      sent.push(message)
      options.onSend?.(message)

      return true
    },
    onMessage: () => () => {},
    onChannel: () => () => {},
    onEnded: () => () => {},
  }
  let region = RegionDoc.inMemory('private', regionId)
  let local: LocalDb | undefined

  if (options.persisted) {
    local = (await openTestDb())._unsafeUnwrap()

    databases.push(local)
    region = (
      await RegionDoc.open(options.wrap?.(local) ?? local, { kind: 'private', id: regionId })
    )._unsafeUnwrap()
  }

  const sync = new RegionSync({
    region,
    transport,
    clock,
    actor: regionId,
    onSettled: () => {},
    onError: (error) => errors.push(error),
    // Only an engine replaces a region's document.
    onReset: () => {},
  })
  const count = (type: ClientMessage['type']) =>
    sent.filter((message) => message.type === type).length

  /** The batch number of the last push sent. */
  const lastBatch = (): number => {
    const push = sent.findLast((message) => message.type === 'push')

    return push?.type === 'push' ? push.batch : expect.unreachable('a push was sent')
  }

  /** Another tab's document of the region, on the same database as this one's. */
  const otherTab = async (): Promise<RegionDoc> =>
    (
      await RegionDoc.open(local ?? expect.unreachable('a persisted region'), {
        kind: 'private',
        id: regionId,
      })
    )._unsafeUnwrap()

  return {
    clock,
    errors,
    region,
    sync,
    count,
    lastBatch,
    otherTab,
    reconnects: () => recycled.count,
  }
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

/** Ann's note, written and synced; then Bob's device goes offline. */
async function annsNoteThenOffline(batchRows?: number) {
  const members = await twoMembers(batchRows === undefined ? {} : { batchRows })
  const annsNote = noteIdFactory.create()

  noteCreate(members.a.region.doc, { id: annsNote, author: ann, text: 'hello' })
  members.a.engine.localWrite()
  await members.settle()
  members.b.transport.goOffline()

  return { ...members, annsNote, anns: recordKey('note', annsNote) }
}

/** `edits` edits of Ann's note by Bob, made durable: rows the gateway refuses, as Bob is a member. */
async function editOffline(region: RegionDoc, annsNote: NoteId, edits: number) {
  for (let edit = 0; edit < edits; edit += 1) {
    noteUpdate(region.doc, { id: annsNote, text: `mine ${edit}` })
  }

  expect((await region.flush()).isOk()).toBe(true)
}

/** The gateway's head of `region`. */
async function headOf(stub: GatewayStub, region: string): Promise<number> {
  const [entry] = (await stub.hub.heads([region]))._unsafeUnwrap()

  return entry?.head ?? expect.unreachable('the hub answers every region asked')
}

/** A device database on which every region reset fails, as on a broken database. */
const refuseResets = (local: LocalDb) =>
  interceptRegionResets(local, () => {
    throw new Error('the database refuses the reset')
  })

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

  it('pulls once when an import first fails, and leaves the repeats to the full pass', async () => {
    let failImport = false
    const { sync, count, errors, region } = await alone({
      persisted: true,
      wrap: (local) =>
        interceptQueries(local, (text) => {
          if (failImport && text === importStatement) {
            throw new Error('the store refused the write')
          }
        }),
    })
    const { all } = serverHistory()

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))

    failImport = true
    await sync.handle(updates(all, 2))

    expect(count('pull')).toBe(1)
    expect(errors).toHaveLength(1)

    // The pull's answer fails again: nothing is sent at network round-trip rate.
    await sync.handle(updates(all, 2))

    expect(count('pull')).toBe(1)
    expect(errors).toHaveLength(2)

    sync.retryPull()

    expect(count('pull')).toBe(2)

    failImport = false
    await sync.handle(updates(all, 2))

    expect(region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })

    sync.retryPull()

    expect(count('pull')).toBe(2)
  })

  it('gives up on a pull whose answer never comes after 30 seconds, reports it once and reconnects', async () => {
    const { sync, count, errors, clock, reconnects } = await alone()

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))
    await sync.handle(updates(serverHistory().gap, 2))
    await clock.advance(29_999)

    expect(sync.quiet()).toBe(false)

    await clock.advance(1)

    expect(sync.quiet()).toBe(true)
    expect(errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])
    expect(reconnects()).toBe(1)

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

  it('moves the cursor on the ack of a first push, never on the ack of a push sent again', async () => {
    // The server took nothing from others before the batch: its head is the batch's own.
    const ack = (batch: number): ServerMessage => ({
      type: 'ack',
      region: regionId,
      batch,
      head: 1,
      compact: false,
    })
    const first = await alone({ persisted: true })

    first.sync.subscribe()
    await first.sync.handle(updates(emptyRegion, 0, true))
    writeName(first.region, 'Ann')
    const pushed = first.sync.pushNext()

    await vi.waitFor(() => expect(first.count('push')).toBe(1))
    await first.sync.handle(ack(first.lastBatch()))

    expect(await pushed).toBe('sent')
    expect(first.region.pulled()).toBe(1)

    // The same batch, given up once and sent again: the server may have stored it before, and
    // its ack then names a head that the cursor must not take on trust.
    const again = await alone({ persisted: true })

    again.sync.subscribe()
    await again.sync.handle(updates(emptyRegion, 0, true))
    writeName(again.region, 'Ann')
    const givenUp = again.sync.pushNext()

    await vi.waitFor(() => expect(again.count('push')).toBe(1))
    await again.clock.advance(30_000)

    expect(await givenUp).toBe('down')

    const retried = again.sync.pushNext()

    await vi.waitFor(() => expect(again.count('push')).toBe(2))
    await again.sync.handle(ack(again.lastBatch()))

    expect(await retried).toBe('sent')
    expect(again.region.pulled()).toBe(0)
    expect((await again.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('imports what another tab wrote before pushing it, and pushes nothing while that fails', async () => {
    let failTail = false
    const { sync, count, region, errors, lastBatch, otherTab } = await alone({
      persisted: true,
      wrap: (local) =>
        interceptQueries(local, (text) => {
          if (failTail && text === localTailStatement) {
            failTail = false
            throw new Error('the store is busy')
          }
        }),
    })

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))

    // A follower tab writes into the shared database; this leader has not read it yet.
    const follower = await otherTab()

    writeName(follower, 'Bea')
    expect((await follower.flush()).isOk()).toBe(true)

    // Reading the follower's row fails once: the round ends, and nothing goes out.
    failTail = true

    const first = sync.pushNext()

    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(await first).toBe('down')
    expect(count('push')).toBe(0)
    expect(errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])

    const pushed = sync.pushNext()

    await vi.waitFor(() => expect(count('push')).toBe(1))
    expect(region.recordJson(profileKey)).toMatchObject({ name: 'Bea' })

    // The server took nothing from others before the batch: the ack moves the cursor.
    await sync.handle({
      type: 'ack',
      region: regionId,
      batch: lastBatch(),
      head: 1,
      compact: false,
    })

    expect(await pushed).toBe('sent')
    expect(region.pulled()).toBe(1)
    expect((await region.outbox(10))._unsafeUnwrap()).toEqual([])
    expect(errors).toHaveLength(1)
    follower.close()
  })

  it('imports the rows it pushes, a row another tab appended after its catch-up included', async () => {
    let beforeOutboxRead: (() => Promise<void>) | undefined
    const nameAtPush: unknown[] = []
    const leader = await alone({
      persisted: true,
      wrap: (local) =>
        interceptQueries(local, (text) => {
          const run = beforeOutboxRead

          if (text !== outboxReadStatement || !run) {
            return undefined
          }

          beforeOutboxRead = undefined

          return run()
        }),
      onSend: (message) => {
        if (message.type === 'push') {
          nameAtPush.push(leader.region.recordJson(profileKey)?.['name'])
        }
      },
    })
    const { sync, count, region, errors, lastBatch, otherTab } = leader

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))

    const follower = await otherTab()

    // The leader has imported the local log; a follower appends a row before the outbox is read.
    beforeOutboxRead = async () => {
      writeName(follower, 'Bea')
      expect((await follower.flush()).isOk()).toBe(true)
    }

    const pushed = sync.pushNext()

    await vi.waitFor(() => expect(count('push')).toBe(1))

    // The leader's document holds the row by the time it goes out.
    expect(nameAtPush).toEqual(['Bea'])

    // The server took nothing from others before the batch: the ack moves the cursor over it.
    await sync.handle({
      type: 'ack',
      region: regionId,
      batch: lastBatch(),
      head: 1,
      compact: false,
    })

    expect(await pushed).toBe('sent')
    expect(region.pulled()).toBe(1)
    expect(region.recordJson(profileKey)).toMatchObject({ name: 'Bea' })
    expect(errors).toEqual([])
    follower.close()
  })

  it('releases a push whose answer never comes after 30 seconds, reports it once and reconnects', async () => {
    const { sync, count, region, errors, clock, reconnects } = await alone({ persisted: true })

    sync.subscribe()
    await sync.handle(updates(emptyRegion, 0, true))
    writeName(region, 'Ann')
    const pushed = sync.pushNext()

    await vi.waitFor(() => expect(count('push')).toBe(1))
    await clock.advance(30_000)

    expect(await pushed).toBe('down')
    expect(errors).toEqual([expect.objectContaining({ code: 'data:QUERY_FAILED' })])
    expect(reconnects()).toBe(1)
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

  it('keeps pulling after an import failed until what it carried arrives, whatever imports cleanly meanwhile', async () => {
    let failImport = false
    const gateway = await openGateway()
    const a = await openDevice(gateway)
    const b = await openDevice(gateway, {
      wrap: (local) =>
        interceptQueries(local, (text) => {
          if (failImport && text === importStatement) {
            failImport = false
            throw new Error('the store refused the write')
          }
        }),
    })
    const c = await openDevice(gateway)

    for (const device of [a, b, c]) {
      device.engine.start()
    }

    writeName(a.region, 'Ann')
    a.engine.localWrite()
    await settleAll([a, b, c])

    // c writes a bio offline, before it hears of the next name.
    c.transport.goOffline()
    writeBio(c.region, 'from c')

    // b fails to store the batch that names the profile Ana, and the pull it sends at once is refused.
    failImport = true
    gateway.stub.refuseNextPull()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await vi.waitFor(() =>
      expect(b.errors.map((error) => error.code)).toEqual([
        'data:WRITE_FAILED',
        'data:QUERY_FAILED',
      ]),
    )

    // c's bio reaches b as a batch that does not depend on the lost one: it imports cleanly.
    c.transport.goOnline()
    await settleAll([a, c])
    await vi.waitFor(() => expect(b.region.recordJson(profileKey)).toMatchObject({ bio: 'from c' }))

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })

    // The next full pass pulls again, and the name arrives.
    b.engine.visibility('hidden')
    b.engine.visibility('visible')
    await b.engine.settled(60_000)

    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana', bio: 'from c' })
    expect(b.errors).toHaveLength(2)
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

  it('reports a rejected batch as a push rejection, undoes it and keeps syncing', async () => {
    const { a, b, settle, errors } = await twoDevices()

    a.region.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    a.region.doc.commit()
    a.engine.localWrite()
    await settle()

    expect(errors()).toMatchObject([
      {
        code: 'data:PUSH_REJECTED',
        cause: { region: a.region.ref.id, reason: 'foreign-table', detail: 'note/n_1' },
      },
    ])
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ana' })
  })

  it('reports a forbidden edit as a push rejection, undoes it and keeps syncing', async () => {
    const { a, b, settle, errors } = await twoMembers()
    const annsNote = noteIdFactory.create()
    const bobsNote = noteIdFactory.create()
    const anns = recordKey('note', annsNote)
    const bobs = recordKey('note', bobsNote)

    noteCreate(a.region.doc, { id: annsNote, author: ann, text: 'hello' })
    a.engine.localWrite()
    await settle()
    // Bob is a member: the gateway refuses his edit of Ann's note, and his device undoes it.
    noteUpdate(b.region.doc, { id: annsNote, text: 'mine now' })
    b.engine.localWrite()
    await settle()

    expect(errors()).toMatchObject([
      {
        code: 'data:PUSH_REJECTED',
        cause: { region: b.region.ref.id, reason: 'forbidden-action', detail: `${anns}:update` },
      },
    ])
    expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello' })

    noteCreate(b.region.doc, { id: bobsNote, author: bob, text: 'mine' })
    b.engine.localWrite()
    await settle()

    expect(a.region.recordJson(bobs)).toMatchObject({ text: 'mine' })
    expect(a.region.recordJson(anns)).toMatchObject({ text: 'hello' })
    expect(errors().map((error) => error.code)).toEqual(['data:PUSH_REJECTED'])
  })

  describe('a refused batch the push limit fills', () => {
    it('pushes the refused rows of a full batch and their undo together, and keeps syncing', async () => {
      const { a, b, settle, errors, annsNote, anns } = await annsNoteThenOffline(3)
      const bobsNote = noteIdFactory.create()

      await editOffline(b.region, annsNote, 3)
      b.transport.goOnline()
      await settle()

      expect(errors().map((error) => error.code)).toEqual(['data:PUSH_REJECTED'])
      expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello' })
      expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])

      noteCreate(b.region.doc, { id: bobsNote, author: bob, text: 'mine' })
      b.engine.localWrite()
      await settle()

      expect(a.region.recordJson(recordKey('note', bobsNote))).toMatchObject({ text: 'mine' })
      expect(a.region.recordJson(anns)).toMatchObject({ text: 'hello' })
      expect(errors().map((error) => error.code)).toEqual(['data:PUSH_REJECTED'])
    })

    it('pushes the rows another tab queued before the undo together with it', async () => {
      const { a, b, settle, errors, annsNote, anns } = await annsNoteThenOffline(3)
      const bobsNote = noteIdFactory.create()
      // Another tab of Bob's browser on the same database, open before his refused edits.
      const tab = (await RegionDoc.open(b.local, b.region.ref))._unsafeUnwrap()

      await editOffline(b.region, annsNote, 3)
      // The tab writes a note of Bob's own: its row lands behind the refused rows.
      noteCreate(tab.doc, { id: bobsNote, author: bob, text: 'from the other tab' })
      expect((await tab.flush()).isOk()).toBe(true)
      tab.close()
      b.transport.goOnline()
      await settle()

      expect(errors().map((error) => error.code)).toEqual(['data:PUSH_REJECTED'])
      expect(a.region.recordJson(recordKey('note', bobsNote))).toMatchObject({
        text: 'from the other tab',
      })
      expect(a.region.recordJson(anns)).toMatchObject({ text: 'hello' })
      expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])
    })

    it('pushes the refused rows of a batch at the protocol limit and their undo as one update', async () => {
      const { a, b, settle, errors, annsNote, anns } = await annsNoteThenOffline()

      await editOffline(b.region, annsNote, MAX_PUSH_UPDATES)
      b.transport.goOnline()
      await settle()

      expect(errors().map((error) => error.code)).toEqual(['data:PUSH_REJECTED'])
      expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello' })
      expect(a.region.recordJson(anns)).toMatchObject({ text: 'hello' })
      expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])
    })
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

describe('a region whose rollback the gateway refuses again', () => {
  it('reloads the region from the server when another tab wrote on top of the refused rows, and keeps syncing', async () => {
    const { a, b, settle, errors, stub, annsNote, anns } = await annsNoteThenOffline(3)
    const head = await headOf(stub, a.region.ref.id)
    const tabsNote = noteIdFactory.create()
    const bobsNote = noteIdFactory.create()

    await editOffline(b.region, annsNote, 3)

    // Another tab of Bob's browser takes the refused rows in, then writes a note on top of them.
    const tab = (await RegionDoc.open(b.local, b.region.ref))._unsafeUnwrap()

    expect((await tab.catchUpLocal()).isOk()).toBe(true)
    noteCreate(tab.doc, { id: tabsNote, author: bob, text: 'from the other tab' })
    expect((await tab.flush()).isOk()).toBe(true)
    b.transport.goOnline()
    await settle()

    expect(errors().map((error) => error.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])
    expect(stub.rejections()).toBe(2)
    // The server took nothing of Bob's; the other tab's note went with the refused rows.
    expect(await headOf(stub, a.region.ref.id)).toBe(head)
    expect(a.region.recordJson(anns)).toMatchObject({ text: 'hello' })
    expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello' })
    expect(a.region.recordJson(recordKey('note', tabsNote))).toBeUndefined()
    expect(b.region.recordJson(recordKey('note', tabsNote))).toBeUndefined()
    expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])
    // The tab, still on the copy that was dropped, is refused.
    expect((await tab.catchUpLocal())._unsafeUnwrapErr().code).toBe('data:REGION_STALE')
    tab.close()

    noteCreate(b.region.doc, { id: bobsNote, author: bob, text: 'mine' })
    b.engine.localWrite()
    await settle()
    noteUpdate(a.region.doc, { id: annsNote, text: 'hello again' })
    a.engine.localWrite()
    await settle()

    expect(a.region.recordJson(recordKey('note', bobsNote))).toMatchObject({ text: 'mine' })
    expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello again' })
    expect(errors().map((error) => error.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])
  })

  it('reloads the region from the server when an undone delete meets an edit the device had not heard, and keeps syncing', async () => {
    const { a, b, settle, errors, stub } = await twoMembers()
    const annsNote = noteIdFactory.create()
    const bobsNote = noteIdFactory.create()
    const anns = recordKey('note', annsNote)

    noteCreate(a.region.doc, { id: annsNote, author: ann, text: 'hello' })
    a.engine.localWrite()
    await settle()
    stub.dropNextFanOutTo(b.transport)
    noteUpdate(a.region.doc, { id: annsNote, text: 'hello again' })
    a.engine.localWrite()
    await a.engine.settled(60_000)

    const head = await headOf(stub, a.region.ref.id)

    // Bob is a member: the gateway refuses his delete of Ann's note, and the undo brings back
    // the text he last heard, which the gateway refuses as his edit.
    noteDelete(b.region.doc, { id: annsNote })
    b.engine.localWrite()
    await settle()

    expect(errors().map((error) => error.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])
    expect(await headOf(stub, a.region.ref.id)).toBe(head)
    expect(a.region.recordJson(anns)).toMatchObject({ text: 'hello again' })
    expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello again' })
    expect((await b.region.outbox(10))._unsafeUnwrap()).toEqual([])

    noteCreate(b.region.doc, { id: bobsNote, author: bob, text: 'mine' })
    b.engine.localWrite()
    await settle()
    noteUpdate(a.region.doc, { id: annsNote, text: 'hello at last' })
    a.engine.localWrite()
    await settle()

    expect(a.region.recordJson(recordKey('note', bobsNote))).toMatchObject({ text: 'mine' })
    expect(b.region.recordJson(anns)).toMatchObject({ text: 'hello at last' })
    expect(errors().map((error) => error.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])
  })

  it('reloads from the server a region whose rollback is rejected too, with the one rejection reported', async () => {
    const { a, settle, stub, errors } = await twoDevices()

    stub.rejectEverything()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(errors()).toMatchObject([
      { code: 'data:PUSH_REJECTED' },
      {
        code: 'data:REGION_RELOADED',
        cause: { region: a.region.ref.id, reason: 'foreign-table' },
      },
    ])
    expect(stub.rejections()).toBe(2)
    expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })
    expect((await a.region.outbox(10))._unsafeUnwrap()).toEqual([])
  })

  it('stops syncing a region whose reload fails, and reports it', async () => {
    const { a, settle, stub, errors } = await twoDevices({}, { wrap: refuseResets })
    const before = a.region

    stub.rejectEverything()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await settle()

    expect(errors().map((error) => error.code)).toEqual(['data:PUSH_REJECTED', 'data:SYNC_STOPPED'])
    expect(a.region).toBe(before)
    expect((await a.region.outbox(10))._unsafeUnwrap().length).toBeGreaterThan(0)
  })

  it('opens again a region another tab reset, and syncs it', async () => {
    const { a, b, settle, errors } = await twoDevices()
    const before = b.region
    const other = (await RegionDoc.open(b.local, b.region.ref))._unsafeUnwrap()

    ;(await replaceRegionDoc(b.local, other, 'reset'))._unsafeUnwrap().close()
    b.engine.localWrite()
    await settle()

    expect(b.region).not.toBe(before)
    expect(b.region.recordJson(profileKey)).toMatchObject({ name: 'Ann' })

    writeName(b.region, 'Bea')
    b.engine.localWrite()
    await settle()

    expect(a.region.recordJson(profileKey)).toMatchObject({ name: 'Bea' })
    expect(errors()).toEqual([])
  })

  it('settles only once a reload has finished', async () => {
    let reached = () => {}
    const resetting = new Promise<void>((resolve) => {
      reached = resolve
    })
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { a, settle, stub } = await twoDevices(
      {},
      {
        wrap: (local) =>
          interceptRegionResets(local, () => {
            reached()

            return held
          }),
      },
    )

    stub.rejectEverything()
    writeName(a.region, 'Ana')
    a.engine.localWrite()
    await resetting

    let done = false
    const settled = settle().then(() => {
      done = true
    })

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(done).toBe(false)

    release()
    await settled

    expect(a.errors.map((error) => error.code)).toEqual([
      'data:PUSH_REJECTED',
      'data:REGION_RELOADED',
    ])
  })
})
