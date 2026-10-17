/**
 * What a member's device pushes to an organisation's tenant region: notes written through the
 * replica's write path on a region document of the device's own (the author as the record
 * reference `member:<identity id>`) and exported as the update bytes a push carries.
 */

import type { ResultAsync } from 'neverthrow'

import type { Command, DataError } from '@workspace/data'
import type { RegionDoc } from '@workspace/replica'

import createNoteText from './create-note.surql'
import deleteNoteText from './delete-note.surql'
import { updateOf } from './profile'
import updateNoteText from './update-note.surql'

export interface NoteInput {
  /** The note's id, `nte_…`. */
  readonly id: string
  /** The identity id of the member who writes it, `idn_…`. */
  readonly author: string
  readonly text: string
}

const id = { name: 'id', type: 'record<note>' } as const

const createNote: Command<NoteInput> = {
  id: 'gateway.fixture.createNote',
  kind: 'command',
  text: createNoteText,
  params: [id, { name: 'author', type: 'record<member>' }, { name: 'text', type: 'string' }],
  tables: ['note'],
  region: 'tenant',
  ops: [
    {
      op: 'create',
      record: 'id',
      fields: { author: { param: 'author' }, text: { param: 'text' } },
    },
  ],
}

const updateNote: Command<{ id: string; text: string }> = {
  id: 'gateway.fixture.updateNote',
  kind: 'command',
  text: updateNoteText,
  params: [id, { name: 'text', type: 'string' }],
  tables: ['note'],
  region: 'tenant',
  ops: [{ op: 'text.update', record: 'id', field: 'text', value: { param: 'text' } }],
}

const deleteNote: Command<{ id: string }> = {
  id: 'gateway.fixture.deleteNote',
  kind: 'command',
  text: deleteNoteText,
  params: [id],
  tables: ['note'],
  region: 'tenant',
  ops: [{ op: 'delete', record: 'id' }],
}

/** Writes a note in the device's document of the tenant region; answers with the update to push. */
export function noteCreate(
  doc: RegionDoc,
  note: NoteInput,
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  return updateOf(doc, createNote, note)
}

/** Rewrites the text of a note the device's document holds; answers with the update to push. */
export function noteUpdate(
  doc: RegionDoc,
  note: { readonly id: string; readonly text: string },
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  return updateOf(doc, updateNote, note)
}

/** Removes a note the device's document holds; answers with the update to push. */
export function noteDelete(
  doc: RegionDoc,
  note: { readonly id: string },
): ResultAsync<Uint8Array<ArrayBuffer>, DataError> {
  return updateOf(doc, deleteNote, note)
}
