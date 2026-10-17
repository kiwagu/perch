import { type ContainerID, LoroDoc, LoroMap, LoroText } from 'loro-crdt'
import { describe, expect, it } from 'vitest'

import { recordRef } from '@workspace/data'
import { noteIdFactory } from '@workspace/ids'
import { defineAbilityFor } from '@workspace/kernel'

import {
  noteCreate,
  noteDelete,
  noteRemoveAuthor,
  noteSetAuthor,
  noteUpdate,
  replicaSchema,
} from '../__fixtures__/note'
import type { ReplicaSchema } from '../schema'
import { invert } from '../sync/region-sync'

import { documentWithProfile, exportSince, forkOf, input } from './__fixtures__/batch'
import { validateBatch } from './batch-validator'

/** The inverse a device commits for a refused update, as the bytes it pushes behind it. */
function undo(device: LoroDoc, refused: Uint8Array): Uint8Array {
  const from = device.version()

  invert(device, [{ id: 'refused', seq: 1, bytes: refused }])
  device.commit()

  return device.export({ mode: 'update', from })
}

/**
 * The bytes of a forged push: the text operation of a note's mergeable text, moved through
 * Loro's JSON form of the changes onto the mergeable text `target` names.
 */
function retargetedText(target: ContainerID): Uint8Array {
  const template = new LoroDoc()

  template
    .getMap('records')
    .setContainer('note/own', new LoroMap())
    .ensureMergeableText('text')
    .insert(0, 'forged ')
  template.commit()

  const json = template.exportJsonUpdates()

  for (const change of json.changes) {
    change.ops = change.ops
      .filter((op) => op.container.startsWith('cid:root-🤝'))
      .map((op, index) => ({ ...op, container: target, counter: index }))
  }

  const forged = new LoroDoc()

  forged.importJsonUpdates(json)

  return forged.export({ mode: 'update' })
}

describe('batch validation', () => {
  it('turns an accepted edit into one projected row with column values', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')

    const result = validateBatch(input(server, [exportSince(client, server)]))

    const { plan } = result._unsafeUnwrap()

    expect(plan.upserts).toMatchObject([{ table: 'profile', key: 'prf_1', data: { name: 'Ana' } }])
    expect(plan.upserts[0]?.data['created_at']).toBeInstanceOf(Date)
    expect(plan.deletes).toEqual([])
  })

  it('projects a record whose text field changed', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)
    const bio = client.recordMap('profile/prf_1').get('bio') as LoroText

    bio.insert(5, ', world')

    const { plan } = validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrap()

    expect(plan.upserts).toMatchObject([{ key: 'prf_1', data: { bio: 'Hello, world' } }])
  })

  it('plans the bytes that bring the authoritative document to the version of the fork', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')

    const { fork, plan } = validateBatch(
      input(server, [exportSince(client, server)]),
    )._unsafeUnwrap()
    const replay = forkOf(server)

    replay.import(plan.bytes)

    expect(replay.version().encode()).toEqual(plan.version)
    expect(plan.version).toEqual(fork.version().encode())
    expect(replay.recordMap('profile/prf_1').get('name')).toBe('Ana')
  })

  it('plans a deletion for a removed record', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().delete('profile/prf_1')

    const { plan } = validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrap()

    expect(plan.deletes).toEqual([{ table: 'profile', key: 'prf_1', entry: 'profile/prf_1' }])
  })

  it('refuses a record of a table outside the region', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('foreign-table')
  })

  it('refuses a private record that points at another identity', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('identity', 'identity:idn_other')

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('foreign-owner')
  })

  it('refuses a record that is a plain value instead of a map', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().set('profile/prf_2', 'Ana')

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('invalid-record')
  })

  it('refuses a batch that writes a root container other than the records', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.getMap('other').set('x', 1)

    expect(validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr()).toEqual({
      reason: 'malformed',
      detail: 'writes outside records: cid:root-other:Map',
    })
  })

  it('refuses the whole batch when it edits a record and writes outside the records', () => {
    const server = documentWithProfile('Ann')
    const before = server.version().encode()
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')
    client.getMap('other').set('x', 1)

    expect(
      validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr().reason,
    ).toBe('malformed')
    expect(server.version().encode()).toEqual(before)
    expect(server.recordMap('profile/prf_1').get('name')).toBe('Ann')
  })

  it('refuses a batch that writes a list root under the name of the records', () => {
    const server = documentWithProfile('Ann')
    const before = server.version().encode()
    const client = forkOf(server)

    client
      .getList('records')
      .insertContainer(0, new LoroMap())
      .set('identity', 'identity:idn_other')

    expect(validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr()).toEqual({
      reason: 'malformed',
      detail: 'writes outside records: cid:root-records:List',
    })
    expect(server.version().encode()).toEqual(before)
  })

  it('refuses a batch that writes a text root under the name of the records', () => {
    const server = documentWithProfile('Ann')
    const before = server.version().encode()
    const client = forkOf(server)

    client.getText('records').insert(0, 'x')

    expect(validateBatch(input(server, [exportSince(client, server)]))._unsafeUnwrapErr()).toEqual({
      reason: 'malformed',
      detail: 'writes outside records: cid:root-records:Text',
    })
    expect(server.version().encode()).toEqual(before)
  })

  it('refuses bytes that are not a Loro update', () => {
    expect(
      validateBatch(
        input(documentWithProfile('Ann'), [new Uint8Array([1, 2, 3])]),
      )._unsafeUnwrapErr().reason,
    ).toBe('malformed')
  })

  it('refuses an update that depends on history the server lacks', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')
    client.commit()

    const middle = client.version()

    client.recordMap('profile/prf_1').set('name', 'Anna')

    const update = client.export({ mode: 'update', from: middle })

    expect(validateBatch(input(server, [update]))._unsafeUnwrapErr().reason).toBe(
      'pending-dependencies',
    )
  })

  it('accepts a batch whose net effect is empty: an edit followed by its inverse', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.records().setContainer('note/n_1', new LoroMap()).set('text', 'x')
    client.commit()
    client.records().delete('note/n_1')

    expect(validateBatch(input(server, [exportSince(client, server)])).isOk()).toBe(true)
  })

  it('leaves the authoritative document untouched', () => {
    const server = documentWithProfile('Ann')
    const before = server.version().encode()
    const client = forkOf(server)

    client.recordMap('profile/prf_1').set('name', 'Ana')

    expect(validateBatch(input(server, [exportSince(client, server)])).isOk()).toBe(true)
    expect(server.version().encode()).toEqual(before)
    expect(server.recordMap('profile/prf_1').get('name')).toBe('Ann')
  })

  it('refuses a batch whose write outside the records was undone in the same batch', () => {
    const server = documentWithProfile('Ann')
    const client = forkOf(server)

    client.getMap('junk').set('k', 1)
    client.getMap('junk').delete('k')
    client.recordMap('profile/prf_1').set('name', 'Ana')

    const validated = validateBatch(input(server, [exportSince(client, server)]))

    expect(validated.isErr() && validated.error).toEqual({
      reason: 'malformed',
      detail: 'writes outside records: cid:root-junk:Map',
    })
  })
})

describe('a tenant region', () => {
  const region = { kind: 'tenant', id: 'tenant:acme' } as const
  const ann = 'idn_ann000000000000.0000000000'
  const bob = 'idn_bob000000000000.0000000000'
  const member = (id: string) => defineAbilityFor({ id, role: 'member' }, replicaSchema)
  const admin = (id: string) => defineAbilityFor({ id, role: 'admin' }, replicaSchema)

  it('accepts a note whose author is the pushing member', () => {
    const doc = new LoroDoc()
    const updates = [noteCreate(doc, { id: noteIdFactory.create(), author: ann, text: 'hello' })]
    const validated = validateBatch({
      doc: new LoroDoc(),
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates,
    })

    expect(validated.isOk()).toBe(true)
    expect(recordRef(validated._unsafeUnwrap().plan.upserts[0]?.data['author'])).toEqual({
      table: 'member',
      key: ann,
    })
  })

  it('refuses a note created in the name of another member', () => {
    const doc = new LoroDoc()
    const updates = [noteCreate(doc, { id: noteIdFactory.create(), author: bob, text: 'hello' })]
    const validated = validateBatch({
      doc: new LoroDoc(),
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates,
    })

    expect(validated.isErr() && validated.error.reason).toBe('foreign-owner')
  })

  it('lets a member edit the text of its own note, not its author', () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const edited = validateBatch({
      doc: server,
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates: [noteUpdate(server.fork(), { id, text: 'hello, world' })],
    })
    const reauthored = validateBatch({
      doc: server,
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates: [noteSetAuthor(server.fork(), { id, author: bob })],
    })

    expect(edited.isOk()).toBe(true)
    expect(reauthored.isErr() && reauthored.error.reason).toBe('foreign-owner')
  })

  it("refuses a member editing or deleting another member's note as forbidden-action", () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const edited = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [noteUpdate(server.fork(), { id, text: 'mine now' })],
    })
    const deleted = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [noteDelete(server.fork(), { id })],
    })

    expect(edited.isErr() && edited.error).toEqual({
      reason: 'forbidden-action',
      detail: `note/${id}:update`,
    })
    expect(deleted.isErr() && deleted.error).toEqual({
      reason: 'forbidden-action',
      detail: `note/${id}:delete`,
    })
  })

  it("lets an admin edit and delete another member's note, and a member delete its own", () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const edited = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: admin(bob),
      schema: replicaSchema,
      updates: [noteUpdate(server.fork(), { id, text: 'edited by the admin' })],
    })
    const deletedByAdmin = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: admin(bob),
      schema: replicaSchema,
      updates: [noteDelete(server.fork(), { id })],
    })
    const deletedByOwner = validateBatch({
      doc: server,
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates: [noteDelete(server.fork(), { id })],
    })

    expect(edited.isOk()).toBe(true)
    expect(deletedByAdmin._unsafeUnwrap().plan.deletes).toMatchObject([{ table: 'note', key: id }])
    expect(deletedByOwner.isOk()).toBe(true)
  })

  it('refuses a client write to a tenant table that declares no abilities', () => {
    const closed: ReplicaSchema = {
      ...replicaSchema,
      note: { region: 'tenant', fields: replicaSchema['note']?.fields ?? {} },
    }
    const id = noteIdFactory.create()
    const validated = validateBatch({
      doc: new LoroDoc(),
      region,
      actor: ann,
      ability: defineAbilityFor({ id: ann, role: 'admin' }, closed),
      schema: closed,
      updates: [noteCreate(new LoroDoc(), { id, author: ann, text: 'hello' })],
    })

    expect(validated.isErr() && validated.error).toEqual({
      reason: 'forbidden-action',
      detail: `note/${id}:create`,
    })
  })

  it("lets a member undo a refused edit of another member's note: the change and its inverse in one batch are no change", () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const device = server.fork()
    const refused = noteUpdate(device, { id, text: 'mine now' })
    const undone = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [refused, undo(device, refused)],
    })

    expect(undone.isOk()).toBe(true)
    expect(undone._unsafeUnwrap().plan).toMatchObject({ upserts: [], deletes: [] })
  })

  it("lets a member undo a refused delete of another member's note", () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const device = server.fork()
    const refused = noteDelete(device, { id })
    const undone = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [refused, undo(device, refused)],
    })

    expect(undone.isOk()).toBe(true)
    expect(undone._unsafeUnwrap().plan).toMatchObject({ upserts: [], deletes: [] })
  })

  it("refuses a member's delete and re-creation of another member's note with other content as an update", () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const replaced = (text: string) => {
      const device = server.fork()

      return validateBatch({
        doc: server,
        region,
        actor: bob,
        ability: member(bob),
        schema: replicaSchema,
        updates: [noteDelete(device, { id }), noteCreate(device, { id, author: ann, text })],
      })
    }
    const rewritten = replaced('mine now')
    // The same content in a new container is no change: it replaces the note's container as a
    // concurrent edit would lose to the last writer, which the merge accepts for any record.
    const unchanged = replaced('hello')

    expect(rewritten.isErr() && rewritten.error).toEqual({
      reason: 'forbidden-action',
      detail: `note/${id}:update`,
    })
    expect(unchanged.isOk()).toBe(true)
    expect(unchanged._unsafeUnwrap().plan).toMatchObject({ upserts: [], deletes: [] })
  })

  it('refuses the whole batch when one record is forbidden', () => {
    const server = new LoroDoc()
    const anns = noteIdFactory.create()
    const bobs = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id: anns, author: ann, text: 'hello' }))
    server.import(noteCreate(server.fork(), { id: bobs, author: bob, text: 'hi' }))

    const device = server.fork()
    const validated = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [
        noteUpdate(device, { id: bobs, text: 'hi there' }),
        noteUpdate(device, { id: anns, text: 'mine now' }),
      ],
    })

    expect(validated.isErr() && validated.error).toEqual({
      reason: 'forbidden-action',
      detail: `note/${anns}:update`,
    })
  })

  it('accepts a note added and deleted again in one batch', () => {
    const server = new LoroDoc()
    const device = server.fork()
    const id = noteIdFactory.create()
    const validated = validateBatch({
      doc: server,
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates: [noteCreate(device, { id, author: ann, text: 'oops' }), noteDelete(device, { id })],
    })

    expect(validated.isOk()).toBe(true)
    expect(validated._unsafeUnwrap().plan).toMatchObject({ upserts: [], deletes: [] })
  })

  it('refuses a crafted mergeable-text root whose path leads outside the records', () => {
    const server = new LoroDoc()
    const device = server.fork()

    device.getMap('other').ensureMergeableText('text').insert(0, 'forged')
    device.commit()

    const validated = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [device.export({ mode: 'update', from: server.version() })],
    })

    // Loro writes the mergeable text's parent before the text, so the root named is the parent's.
    expect(validated.isErr() && validated.error).toEqual({
      reason: 'malformed',
      detail: 'writes outside records: cid:root-other:Map',
    })
  })

  it('refuses a crafted update that makes the diff throw, as malformed', () => {
    // The text of a record that was never created: Loro cannot work out what it changed.
    const validated = validateBatch({
      doc: new LoroDoc(),
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [retargetedText('cid:root-🤝:@1:100>text:Text')],
    })

    expect(validated.isErr() && validated.error.reason).toBe('malformed')
  })

  describe('a field whose shape the schema does not allow', () => {
    /** Ann's note `hello`, and what a batch of `actor` that changes it in `edit` validates to. */
    const changed = (actor: string, edit: (records: LoroMap, key: string) => void) => {
      const server = new LoroDoc()
      const id = noteIdFactory.create()
      const key = `note/${id}`

      server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

      const device = server.fork()

      edit(device.getMap('records'), key)
      device.commit()

      return {
        key,
        validated: validateBatch({
          doc: server,
          region,
          actor,
          ability: member(actor),
          schema: replicaSchema,
          updates: [device.export({ mode: 'update', from: server.version() })],
        }),
      }
    }
    const noteOf = (records: LoroMap, key: string) => records.get(key) as LoroMap

    it("refuses another member's note whose text became a plain string of the same content", () => {
      const { key, validated } = changed(bob, (records, note) => {
        noteOf(records, note).set('text', 'hello')
      })

      expect(validated.isErr() && validated.error).toEqual({
        reason: 'invalid-record',
        detail: `${key}.text`,
      })
    })

    it("refuses another member's note whose text became a text that is not mergeable, of the same content", () => {
      const { key, validated } = changed(bob, (records, note) => {
        noteOf(records, note).setContainer('text', new LoroText()).insert(0, 'hello')
      })

      expect(validated.isErr() && validated.error).toEqual({
        reason: 'invalid-record',
        detail: `${key}.text`,
      })
    })

    it("refuses another member's note deleted and created again with its text as a plain string", () => {
      const { key, validated } = changed(bob, (records, note) => {
        records.delete(note)

        const created = records.setContainer(note, new LoroMap())

        created.set('author', `member:${ann}`)
        created.set('text', 'hello')
      })

      expect(validated.isErr() && validated.error).toEqual({
        reason: 'invalid-record',
        detail: `${key}.text`,
      })
    })

    it('refuses a member planting a plain-string text on its own note', () => {
      const { key, validated } = changed(ann, (records, note) => {
        noteOf(records, note).set('text', 'mine')
      })

      expect(validated.isErr() && validated.error).toEqual({
        reason: 'invalid-record',
        detail: `${key}.text`,
      })
    })
  })

  it('accepts a write into the mergeable text of a field a live note does not set: it has no path, so no record changed', () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    // The id the mergeable text of the unset field would have, worked out on a copy.
    const unset = (
      server.fork().getMap('records').get(`note/${id}`) as LoroMap
    ).ensureMergeableText('other').id
    const validated = validateBatch({
      doc: server,
      region,
      actor: bob,
      ability: member(bob),
      schema: replicaSchema,
      updates: [retargetedText(unset)],
    })

    expect(validated.isOk()).toBe(true)
    expect(validated._unsafeUnwrap().plan).toMatchObject({ upserts: [], deletes: [] })
  })

  it("refuses removing the author of a member's own note as foreign-owner", () => {
    const server = new LoroDoc()
    const id = noteIdFactory.create()

    server.import(noteCreate(server.fork(), { id, author: ann, text: 'hello' }))

    const validated = validateBatch({
      doc: server,
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates: [noteRemoveAuthor(server.fork(), { id })],
    })

    expect(validated.isErr() && validated.error).toEqual({
      reason: 'foreign-owner',
      detail: `note/${id}.author`,
    })
  })

  it('refuses a profile pushed into a tenant region', () => {
    const validated = validateBatch({
      doc: new LoroDoc(),
      region,
      actor: ann,
      ability: member(ann),
      schema: replicaSchema,
      updates: [documentWithProfile('Ann').export({ mode: 'update' })],
    })

    expect(validated.isErr() && validated.error).toEqual({
      reason: 'foreign-table',
      detail: 'profile/prf_1',
    })
  })
})
