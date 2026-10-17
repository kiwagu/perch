/**
 * What a member's device pushes to an organisation's tenant region: notes written straight
 * into a Loro document as the write path writes them (the author as the record reference
 * `member:<identity id>`, the text as a mergeable text container), each in one commit and
 * exported as the update bytes a push carries.
 */

import { type LoroDoc, LoroMap } from 'loro-crdt'

import { recordKey } from '../keys'
import type { ReplicaSchema } from '../schema'

import { profileSchema } from './profile'

/** The replicated tables of both regions: an identity's private profile and an organisation's notes. */
export const replicaSchema: ReplicaSchema = {
  ...profileSchema,
  note: {
    region: 'tenant',
    fields: {
      author: { kind: 'record', table: 'member' },
      text: { kind: 'text' },
      created_at: { kind: 'datetime' },
    },
  },
}

export interface NoteInput {
  /** The note's id, `nte_…`. */
  readonly id: string
  /** The identity id of the member who wrote it, `idn_…`. */
  readonly author: string
  readonly text: string
}

/** Edits the note `id` of the document in one commit and answers with the update it made. */
function updateOf(doc: LoroDoc, id: string, edit: (note: LoroMap) => void): Uint8Array {
  const from = doc.version()

  edit(doc.getMap('records').getOrCreateContainer(recordKey('note', id), new LoroMap()))
  doc.commit()

  return doc.export({ mode: 'update', from })
}

/** Creates a note in the document; answers with the update to push. */
export function noteCreate(doc: LoroDoc, note: NoteInput): Uint8Array {
  return updateOf(doc, note.id, (record) => {
    record.set('author', `member:${note.author}`)
    record.ensureMergeableText('text').update(note.text)
  })
}

/** Rewrites the text of a note the document holds; answers with the update to push. */
export function noteUpdate(
  doc: LoroDoc,
  note: { readonly id: string; readonly text: string },
): Uint8Array {
  return updateOf(doc, note.id, (record) => record.ensureMergeableText('text').update(note.text))
}

/** Names another member as the author of a note the document holds; answers with the update to push. */
export function noteSetAuthor(
  doc: LoroDoc,
  note: { readonly id: string; readonly author: string },
): Uint8Array {
  return updateOf(doc, note.id, (record) => record.set('author', `member:${note.author}`))
}
