import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command, DataError, Shape, ShapeRunnerPort } from '@workspace/data'
import { token } from '@workspace/di'
import { type IdentityId, type NoteId, noteIdFactory } from '@workspace/ids'
import type { Ability } from '@workspace/kernel'

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

const forbidden: BusError = {
  code: 'note:FORBIDDEN',
  message: 'the rules of the organisation do not allow this change',
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
    /** What the signed-in member may do in the current organisation, asked at each change. */
    private readonly ability: () => Ability,
  ) {}

  read(): ResultAsync<readonly NoteRow[], DataError> {
    return this.runner.read(this.model.shape, {})
  }

  watch(onTree: (tree: readonly NoteRow[]) => void): () => void {
    return this.runner.watch(this.model.shape, {}, onTree)
  }

  /** Writes a new note by `author`, the signed-in identity: its document names the member `member:<key>`. */
  add(input: { readonly author: IdentityId; readonly text: string }): ResultAsync<void, BusError> {
    const allowed: Result<string, BusError> = this.ability().can('create', 'note')
      ? ok(input.text)
      : err(forbidden)

    return allowed.andThen(noteText).asyncAndThen((text) =>
      this.commands.execute(this.model.commands.createNote, {
        id: noteIdFactory.create(),
        author: input.author,
        text,
      }),
    )
  }

  edit(input: { readonly id: NoteId; readonly text: string }): ResultAsync<void, BusError> {
    return noteText(input.text).asyncAndThen((text) =>
      this.#noteOf(input.id)
        .andThen((row) => this.#allowed('update', row))
        .andThen(() =>
          this.commands.execute(this.model.commands.updateNote, { id: input.id, text }),
        ),
    )
  }

  remove(input: { readonly id: NoteId }): ResultAsync<void, BusError> {
    return this.#noteOf(input.id)
      .andThen((row) => this.#allowed('delete', row))
      .andThen(() => this.commands.execute(this.model.commands.deleteNote, { id: input.id }))
  }

  /** The note `id` as this device holds it, or `note:NOT_FOUND`. */
  #noteOf(id: NoteId): ResultAsync<NoteRow, BusError> {
    return this.read()
      .mapErr((error): BusError => ({ code: error.code, message: error.message }))
      .andThen((rows) => {
        const row = rows.find((note) => note.id === id)

        return row
          ? okAsync(row)
          : errAsync<NoteRow, BusError>({
              code: 'note:NOT_FOUND',
              message: `no note ${id} on this device`,
            })
      })
  }

  #allowed(action: 'update' | 'delete', row: NoteRow): Result<NoteRow, BusError> {
    return this.ability().can(action, 'note', { ...row }) ? ok(row) : err(forbidden)
  }
}

export const NOTES_SERVICE = token<NotesService>('NotesService')
