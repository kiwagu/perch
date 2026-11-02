import { LoroDoc, LoroMap } from 'loro-crdt'
import { describe, expect, it } from 'vitest'

import { OWNER_ABILITY } from '@workspace/kernel'

import type { RegionRef } from '../region-doc'
import type { ReplicaSchema } from '../schema'

import { validateBatch } from './batch-validator'
import { batchWriter } from './batch-writer'
import { planRecordWrite, type RecordWrite } from './record-write'
import { SERVER_PEER } from './server-peer'

const owner = 'identity:idn_a'

const mine: RegionRef = { kind: 'private', id: owner }

const acme: RegionRef = { kind: 'tenant', id: 'tenant:acme' }

const schema: ReplicaSchema = {
  profile: {
    region: 'private',
    fields: {
      identity: { kind: 'record', table: 'identity' },
      name: { kind: 'plain' },
      email: { kind: 'plain' },
      bio: { kind: 'text' },
    },
  },
  note: {
    region: 'tenant',
    fields: {
      author: { kind: 'record', table: 'member' },
      text: { kind: 'text' },
      created_at: { kind: 'datetime' },
      tags: { kind: 'list' },
      likes: { kind: 'counter' },
    },
  },
}

const newEmail = 'ann@new.example.test'

/** The server's document of the owner's private region, holding the owner's profile `prf_1`. */
function regionWithProfile(): LoroDoc {
  const doc = new LoroDoc()
  const profile = doc.getMap('records').setContainer('profile/prf_1', new LoroMap())

  profile.set('identity', owner)
  profile.set('name', 'Ann')
  profile.set('email', 'ann@example.test')
  profile.ensureMergeableText('bio').update('Hello')
  doc.commit()

  return doc
}

/** The server's document of Acme's region, holding Ann's note `nte_1`. */
function regionWithNote(): LoroDoc {
  const doc = new LoroDoc()
  const note = doc.getMap('records').setContainer('note/nte_1', new LoroMap())

  note.set('author', 'member:idn_ann')
  note.ensureMergeableText('text').update('hello')
  doc.commit()

  return doc
}

function plan(doc: LoroDoc, write: RecordWrite, region: RegionRef = mine) {
  return planRecordWrite({ doc, region, schema, write })
}

const emailWrite: RecordWrite = { table: 'profile', id: 'prf_1', set: { email: newEmail } }

/** A copy of the document, as a device holds it, under a peer of its own. */
function copyOf(doc: LoroDoc): LoroDoc {
  const copy = new LoroDoc()

  copy.import(doc.export({ mode: 'snapshot' }))

  return copy
}

/** A record as the document holds it. */
function recordIn(doc: LoroDoc, entry: string): Readonly<Record<string, unknown>> | undefined {
  const records = doc.getMap('records').toJSON() as Record<string, Record<string, unknown>>

  return records[entry]
}

/** Edits the profile in a device's copy and checks the batch as the server checks the owner's. */
function ownerEdits(server: LoroDoc, device: LoroDoc, edit: (profile: LoroMap) => void) {
  const from = server.version()

  edit(device.getMap('records').get('profile/prf_1') as LoroMap)
  device.commit()

  return validateBatch({
    doc: server,
    region: mine,
    actor: 'idn_a',
    ability: OWNER_ABILITY,
    schema,
    updates: [device.export({ mode: 'update', from })],
  })
}

describe('a write of the server to a record', () => {
  it("sets the fields as the server's peer and plans the record's projection, leaving the region's document as it was", () => {
    const doc = regionWithProfile()
    const before = doc.version()

    const planned = plan(doc, emailWrite)._unsafeUnwrap()

    expect(doc.version().compare(before)).toBe(0)
    expect(planned?.deletes).toEqual([])
    expect(planned?.upserts).toHaveLength(1)
    expect(planned?.upserts[0]).toMatchObject({
      table: 'profile',
      key: 'prf_1',
      entry: 'profile/prf_1',
      data: { name: 'Ann', email: newEmail, bio: 'Hello' },
    })

    const device = copyOf(doc)

    device.import(planned?.bytes ?? new Uint8Array())

    expect(batchWriter('idn_a', doc, device).peers).toEqual([SERVER_PEER])
    expect(recordIn(device, 'profile/prf_1')).toMatchObject({ name: 'Ann', email: newEmail })
    expect(device.version().encode()).toEqual(planned?.version)
  })

  it('writes a datetime as its ISO time and a reference by the id it names, as a command does', () => {
    const doc = regionWithNote()
    const at = new Date('2026-11-02T10:00:00.000Z')

    const planned = plan(
      doc,
      { table: 'note', id: 'nte_1', set: { created_at: at, author: 'idn_bob' } },
      acme,
    )._unsafeUnwrap()
    const device = copyOf(doc)

    device.import(planned?.bytes ?? new Uint8Array())

    expect(recordIn(device, 'note/nte_1')).toEqual({
      author: 'member:idn_bob',
      text: 'hello',
      created_at: '2026-11-02T10:00:00.000Z',
    })
    expect(planned?.upserts[0]?.data['created_at']).toEqual(at)
  })

  it("replaces a text field's whole text through its mergeable text, which an owner's concurrent edit merges with", () => {
    const doc = regionWithProfile()
    // The owner's device holds the region as it was before the server's write.
    const device = copyOf(doc)
    const planned = plan(doc, {
      table: 'profile',
      id: 'prf_1',
      set: { bio: 'Hello there' },
    })._unsafeUnwrap()

    doc.import(planned?.bytes ?? new Uint8Array())

    const edit = ownerEdits(doc, device, (profile) =>
      profile.ensureMergeableText('bio').insert(0, '> '),
    )

    expect(edit._unsafeUnwrap().plan.upserts[0]?.data['bio']).toBe('> Hello there')
  })

  it("leaves the record in a shape the owner's later batch passes: an edit of another field is accepted", () => {
    const doc = regionWithProfile()

    doc.import(plan(doc, emailWrite)._unsafeUnwrap()?.bytes ?? new Uint8Array())

    const edit = ownerEdits(doc, copyOf(doc), (profile) => profile.set('name', 'Ana'))

    expect(edit._unsafeUnwrap().plan.upserts[0]?.data).toMatchObject({
      name: 'Ana',
      email: newEmail,
    })
  })

  it('plans nothing when every field holds the value it is set to', () => {
    const doc = regionWithProfile()

    const same = { email: 'ann@example.test', bio: 'Hello' }

    expect(plan(doc, { table: 'profile', id: 'prf_1', set: same })._unsafeUnwrap()).toBeUndefined()
    expect(plan(doc, { table: 'profile', id: 'prf_1', set: {} })._unsafeUnwrap()).toBeUndefined()
  })

  it.each<[string, RecordWrite, RegionRef, string]>([
    [
      'a table of another kind of region',
      { table: 'note', id: 'nte_1', set: { text: 'hi' } },
      mine,
      'note is not a table of private regions',
    ],
    [
      'a record the region does not hold',
      { table: 'profile', id: 'prf_9', set: { email: newEmail } },
      mine,
      'profile/prf_9 is not a record of identity:idn_a',
    ],
    [
      'a field outside the table',
      { table: 'profile', id: 'prf_1', set: { nickname: 'Annie' } },
      mine,
      'nickname is not a field of profile',
    ],
    [
      "the record's id",
      { table: 'profile', id: 'prf_1', set: { id: 'prf_2' } },
      mine,
      'id is not a field of profile',
    ],
    [
      'a name every object inherits',
      { table: 'profile', id: 'prf_1', set: { constructor: 'x' } },
      mine,
      'constructor is not a field of profile',
    ],
    [
      'another name every object inherits',
      { table: 'profile', id: 'prf_1', set: { toString: 'x' } },
      mine,
      'toString is not a field of profile',
    ],
    [
      'a list',
      { table: 'note', id: 'nte_1', set: { tags: 'urgent' } },
      acme,
      'note.tags is a list, which only its own operations change',
    ],
    [
      'a counter',
      { table: 'note', id: 'nte_1', set: { likes: 3 } },
      acme,
      'note.likes is a counter, which only its own operations change',
    ],
    [
      'another identity in a private region',
      { table: 'profile', id: 'prf_1', set: { identity: 'idn_b' } },
      mine,
      'profile.identity names another identity than identity:idn_a',
    ],
  ])('refuses %s, changing nothing', (_, write, region, message) => {
    const doc = region.kind === 'private' ? regionWithProfile() : regionWithNote()
    const before = doc.version()

    expect(plan(doc, write, region)._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message,
    })
    expect(doc.version().compare(before)).toBe(0)
  })

  it('refuses a record the region deleted', () => {
    const doc = regionWithProfile()

    doc.getMap('records').delete('profile/prf_1')
    doc.commit()

    expect(plan(doc, emailWrite)._unsafeUnwrapErr().message).toBe(
      'profile/prf_1 is not a record of identity:idn_a',
    )
  })

  it("accepts the owner's own identity in a private region", () => {
    const doc = regionWithProfile()

    expect(
      plan(doc, { table: 'profile', id: 'prf_1', set: { identity: 'idn_a' } })._unsafeUnwrap(),
    ).toBeUndefined()
  })
})
