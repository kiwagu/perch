import type { Result, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command, DataError, Shape, ShapeRunnerPort } from '@workspace/data'
import { token } from '@workspace/di'
import { type IdentityId, type NoteId, noteIdFactory } from '@workspace/ids'

import type { CommandsPort } from '../../../platform/commands.port'
import { checkNoteText } from '../domain/note.entity'

/** One note of the organisation page: what the page shows and edits. */
export interface NoteRow {
  readonly id: NoteId
  /** The member who wrote it, by the key of the identity. */
  readonly author: string
  readonly text: string
  readonly created_at: Date
}

/** The reads and writes the service needs; the module passes the ones the modeling stage generated. */
export interface NotesModel {
  readonly shape: Shape<Record<string, never>, readonly NoteRow[]>
  readonly commands: {
    readonly createNote: Command<{
      readonly id: NoteId
      readonly author: string
      readonly text: string
    }>
    readonly updateNote: Command<{ readonly id: NoteId; readonly text: string }>
    readonly deleteNote: Command<{ readonly id: NoteId }>
  }
}

/** A note's text as the domain accepts it, or the rule it breaks. */
function noteText(text: string): Result<string, BusError> {
  return checkNoteText(text).mapErr((violations) => ({
    code: violations[0]?.code ?? 'note:INVALID_TEXT',
    causes: violations,
  }))
}

/**
 * Reads and writes the notes of the current organisation: the runner and the write path send
 * them to its tenant region, and follow the organisation that becomes current.
 */
export class NotesService {
  constructor(
    private readonly runner: ShapeRunnerPort,
    private readonly commands: CommandsPort,
    private readonly model: NotesModel,
  ) {}

  read(): ResultAsync<readonly NoteRow[], DataError> {
    return this.runner.read(this.model.shape, {})
  }

  watch(onTree: (tree: readonly NoteRow[]) => void): () => void {
    return this.runner.watch(this.model.shape, {}, onTree)
  }

  /** Writes a new note by `author`, the signed-in identity: its document names the member `member:<key>`. */
  add(input: { readonly author: IdentityId; readonly text: string }): ResultAsync<void, BusError> {
    return noteText(input.text).asyncAndThen((text) =>
      this.commands.execute(this.model.commands.createNote, {
        id: noteIdFactory.create(),
        author: input.author,
        text,
      }),
    )
  }

  edit(input: { readonly id: NoteId; readonly text: string }): ResultAsync<void, BusError> {
    return noteText(input.text).asyncAndThen((text) =>
      this.commands.execute(this.model.commands.updateNote, { id: input.id, text }),
    )
  }

  remove(input: { readonly id: NoteId }): ResultAsync<void, BusError> {
    return this.commands.execute(this.model.commands.deleteNote, { id: input.id })
  }
}

export const NOTES_SERVICE = token<NotesService>('NotesService')
