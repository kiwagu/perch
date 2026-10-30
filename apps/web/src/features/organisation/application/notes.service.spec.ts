import { okAsync, type ResultAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import type { BusError } from '@workspace/cqrs'
import type { Command } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, idSchemas, noteIdFactory } from '@workspace/ids'
import { type Ability, defineAbilityFor, NO_ABILITY } from '@workspace/kernel'

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
const bob = identityIdFactory.create()

const annsNote = {
  id: noteIdFactory.create(),
  author: ann,
  text: 'Hello',
  created_at: new Date('2026-10-17T12:00:00Z'),
}
const bobsNote = {
  id: noteIdFactory.create(),
  author: bob,
  text: 'Plans',
  created_at: new Date('2026-10-17T12:05:00Z'),
}

const tree: OrganisationResult = [annsNote, bobsNote]

let runner: FakeShapeRunner
let commands: RecordingCommands
let notes: NotesService
let ability: Ability

beforeEach(() => {
  runner = new FakeShapeRunner()
  commands = new RecordingCommands()
  ability = defineAbilityFor({ id: ann, role: 'member' }, replicaSchema)
  runner.set(organisationShape, tree)
  notes = new NotesService(
    runner,
    commands,
    { shape: organisationShape, commands: organisationCommands },
    () => ability,
  )
})

describe('NotesService', () => {
  it('reads and watches the notes of the current organisation, with no parameters', async () => {
    const seen: string[][] = []

    runner.set(organisationShape, tree)

    expect((await notes.read())._unsafeUnwrap()).toEqual(tree)

    const stop = notes.watch((notesTree) => seen.push(notesTree.map(({ text }) => text)))

    expect(seen).toEqual([['Hello', 'Plans']])
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
    const { id } = annsNote

    expect((await notes.edit({ id, text: ' Changed ' })).isOk()).toBe(true)
    expect((await notes.edit({ id, text: ' ' }))._unsafeUnwrapErr().code).toBe('note:TEXT_REQUIRED')
    expect(commands.calls).toEqual([
      { id: 'organisation.organisation.updateNote', params: { id, text: 'Changed' } },
    ])
  })

  it('removes a note', async () => {
    const { id } = annsNote

    expect((await notes.remove({ id })).isOk()).toBe(true)
    expect(commands.calls).toEqual([{ id: 'organisation.organisation.deleteNote', params: { id } }])
  })

  it("refuses editing or removing another member's note before any command runs", async () => {
    expect((await notes.edit({ id: bobsNote.id, text: 'mine' }))._unsafeUnwrapErr().code).toBe(
      'note:FORBIDDEN',
    )
    expect((await notes.remove({ id: bobsNote.id }))._unsafeUnwrapErr().code).toBe('note:FORBIDDEN')
    expect(commands.calls).toEqual([])
  })

  it('lets an admin edit and remove any note, and refuses a note that is not there', async () => {
    ability = defineAbilityFor({ id: ann, role: 'admin' }, replicaSchema)

    expect((await notes.edit({ id: bobsNote.id, text: 'edited' })).isOk()).toBe(true)
    expect((await notes.remove({ id: bobsNote.id })).isOk()).toBe(true)
    expect(
      (await notes.edit({ id: noteIdFactory.create(), text: 'x' }))._unsafeUnwrapErr().code,
    ).toBe('note:NOT_FOUND')
  })

  it('refuses adding a note when nothing is allowed', async () => {
    ability = NO_ABILITY

    expect((await notes.add({ author: ann, text: 'x' }))._unsafeUnwrapErr().code).toBe(
      'note:FORBIDDEN',
    )
    expect(commands.calls).toEqual([])
  })
})
