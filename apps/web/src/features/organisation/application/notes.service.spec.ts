import { okAsync, type ResultAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import type { BusError } from '@workspace/cqrs'
import type { Command } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { identityIdFactory, idSchemas, type NoteId, noteIdFactory } from '@workspace/ids'

import type { CommandsPort } from '../../../platform/commands.port'
import {
  type OrganisationResult,
  organisationCommands,
  organisationShape,
} from '../presentation/pages/organisation/organisation.model.gen'

import { NotesService } from './notes.service'

/** Records the commands it is asked to run and runs none. */
class RecordingCommands implements CommandsPort {
  readonly calls: Array<{ readonly id: string; readonly params: unknown }> = []

  execute<Params>(command: Command<Params>, params: Params): ResultAsync<void, BusError> {
    this.calls.push({ id: command.id, params })

    return okAsync(undefined)
  }
}

const ann = identityIdFactory.create()

const tree: OrganisationResult = [
  {
    id: noteIdFactory.create(),
    author: ann,
    text: 'Hello',
    created_at: new Date('2026-10-17T12:00:00Z'),
  },
]

let runner: FakeShapeRunner
let commands: RecordingCommands
let notes: NotesService

beforeEach(() => {
  runner = new FakeShapeRunner()
  commands = new RecordingCommands()
  notes = new NotesService(runner, commands, {
    shape: organisationShape,
    commands: organisationCommands,
  })
})

describe('NotesService', () => {
  it('reads and watches the notes of the current organisation, with no parameters', async () => {
    const seen: string[][] = []

    runner.set(organisationShape, tree)

    expect((await notes.read())._unsafeUnwrap()).toEqual(tree)

    const stop = notes.watch((notesTree) => seen.push(notesTree.map(({ text }) => text)))

    expect(seen).toEqual([['Hello']])
    expect(runner.lastParams(organisationShape)).toEqual({})

    stop()

    expect(runner.watching(organisationShape)).toBe(0)
  })

  it('adds a note under a new id, by the identity that writes it, with its text trimmed', async () => {
    expect((await notes.add({ author: ann, text: '  Hello all  ' })).isOk()).toBe(true)

    const [call, ...others] = commands.calls
    const { id, params } = call ?? expect.unreachable('a createNote call')
    const { id: noteId, ...rest } = params as { readonly id: string }

    expect(others).toEqual([])
    expect(id).toBe('organisation.organisation.createNote')
    expect(idSchemas.note.schema.safeParse(noteId).success).toBe(true)
    expect(rest).toEqual({ author: ann, text: 'Hello all' })
  })

  it('refuses a blank or too long note before any command runs', async () => {
    expect((await notes.add({ author: ann, text: '   ' }))._unsafeUnwrapErr().code).toBe(
      'note:TEXT_REQUIRED',
    )
    expect((await notes.add({ author: ann, text: 'x'.repeat(501) }))._unsafeUnwrapErr().code).toBe(
      'note:TEXT_TOO_LONG',
    )
    expect(commands.calls).toEqual([])
  })

  it('edits the text of a note, trimmed, and refuses a blank one', async () => {
    const id: NoteId = noteIdFactory.create()

    expect((await notes.edit({ id, text: ' Changed ' })).isOk()).toBe(true)
    expect((await notes.edit({ id, text: ' ' }))._unsafeUnwrapErr().code).toBe('note:TEXT_REQUIRED')
    expect(commands.calls).toEqual([
      { id: 'organisation.organisation.updateNote', params: { id, text: 'Changed' } },
    ])
  })

  it('removes a note', async () => {
    const id: NoteId = noteIdFactory.create()

    expect((await notes.remove({ id })).isOk()).toBe(true)
    expect(commands.calls).toEqual([{ id: 'organisation.organisation.deleteNote', params: { id } }])
  })
})
