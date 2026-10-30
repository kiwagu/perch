import type { Command, Shape } from '@workspace/data'

import createNoteText from './create-note.surql'
import notesText from './notes.surql'

export interface NoteRow {
  readonly id: string
  readonly author: string
  readonly text: string
}

/** Writes a note into the tenant region of the current organisation. */
export const createNote: Command<{ id: string; author: string; text: string }> = {
  id: 'fixture.createNote',
  kind: 'command',
  text: createNoteText,
  params: [
    { name: 'id', type: 'record<note>' },
    { name: 'author', type: 'record<member>' },
    { name: 'text', type: 'string' },
  ],
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

/** The notes of the current organisation, oldest first. */
export const organisationShape: Shape<Record<string, never>, readonly NoteRow[]> = {
  id: 'fixture.organisationNotes',
  kind: 'shape',
  text: notesText,
  params: [],
  tables: ['note'],
}
