import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import { identityIdFactory, noteIdFactory } from '@workspace/ids'

import { createOrganisationMachine, type OrganisationMachineDeps } from './organisation.machine'

const hello = noteIdFactory.create()
const agenda = noteIdFactory.create()
const bea = identityIdFactory.create()

const refused = (code: string): ResultAsync<never, BusError> => errAsync({ code })

/** A write that ends when the test says: done, or refused with a code. */
function later() {
  let end: (outcome: Result<undefined, BusError>) => void = () => undefined
  const result = new ResultAsync<undefined, BusError>(
    new Promise((resolve) => {
      end = resolve
    }),
  )

  return {
    result,
    done: () => end(ok(undefined)),
    refuse: (code: string) => end(err({ code })),
  }
}

/** An organisation page: the organisation current, the page's writes, and the machine over them. */
function page(writes: Partial<OrganisationMachineDeps> = {}) {
  let current: string | undefined = 'acme'
  const deps: OrganisationMachineDeps = {
    select: vi.fn((key: string) => {
      current = key
    }),
    create: vi.fn(() => okAsync(undefined)),
    addNote: vi.fn(() => okAsync(undefined)),
    editNote: vi.fn(() => okAsync(undefined)),
    deleteNote: vi.fn(() => okAsync(undefined)),
    invite: vi.fn(() => okAsync(undefined)),
    remove: vi.fn(() => okAsync(undefined)),
    current: () => current,
    ...writes,
  }
  const actor = createActor(createOrganisationMachine(deps)).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    deps,
    emitted,
    /** Another organisation becomes current without the page choosing it. */
    becomes: (key: string) => {
      current = key
    },
    snapshot: () => actor.getSnapshot(),
    viewing: () => waitFor(actor, (state) => state.matches('viewing')),
    region: (region: string, state: string) =>
      waitFor(actor, (snapshot) => snapshot.matches({ viewing: { [region]: state } })),
  }
}

/** What the machine emits for the frame's toast: the success of a note's change. */
const toast = (code: string) => ({ type: 'show', anchor: 'app-shell.toast', codes: [code] })

describe('organisation machine', () => {
  it('opens and closes the create form by its toggle, and creates from it with its toast', async () => {
    const { actor, deps, snapshot, region, emitted } = page()

    actor.send({ type: 'organisation.create.toggle-button' })

    expect(snapshot().matches({ viewing: { 'create-form': 'open' } })).toBe(true)

    actor.send({ type: 'organisation.create.toggle-button' })

    expect(snapshot().matches({ viewing: { 'create-form': 'closed' } })).toBe(true)

    // Without a membership the form shows with its toggle closed: its submit is taken there too.
    actor.send({ type: 'organisation.create.submit-button', key: 'globex', name: 'Globex' })

    expect(snapshot().can({ type: 'organisation.create.toggle-button' })).toBe(false)

    await region('create-form', 'closed')

    expect(deps.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'globex', name: 'Globex' }),
    )
    expect(emitted).toEqual([toast('organisation-created')])
  })

  it('keeps the create form open with the code of a refused creation, until a creation starts every area afresh', async () => {
    let attempts = 0
    const { actor, snapshot, region } = page({
      // The first creation is refused, the next one done.
      create: () => (attempts++ === 0 ? refused('key-taken') : okAsync(undefined)),
    })

    actor.send({ type: 'organisation.notes.edit-button', id: hello })
    actor.send({ type: 'organisation.create.submit-button', key: 'acme', name: 'Acme' })
    await region('create-form', 'open')

    expect(snapshot().context.errors).toEqual({ of: 'acme', codes: { create: 'key-taken' } })

    actor.send({ type: 'organisation.create.submit-button', key: 'globex', name: 'Globex' })
    await region('create-form', 'closed')

    expect(snapshot().context.errors).toEqual({ of: undefined, codes: {} })
    expect(snapshot().matches({ viewing: { 'note-items': 'idle' } })).toBe(true)
    expect(snapshot().context.editing).toBeUndefined()
  })

  it('edits one note at a time, the one acted on last, and says the save in a toast', async () => {
    const { actor, deps, snapshot, region, emitted } = page()

    actor.send({ type: 'organisation.notes.edit-button', id: hello })
    actor.send({ type: 'organisation.notes.edit-button', id: agenda })

    expect(snapshot().matches({ viewing: { 'note-items': 'editing' } })).toBe(true)
    expect(snapshot().context.editing).toBe(agenda)

    actor.send({ type: 'organisation.notes.save-button', id: agenda, text: 'Agenda, final' })

    expect(snapshot().can({ type: 'organisation.notes.edit-button', id: hello })).toBe(false)
    expect(snapshot().can({ type: 'organisation.notes.delete-button', id: hello })).toBe(false)

    await region('note-items', 'idle')

    expect(deps.editNote).toHaveBeenCalledWith(
      expect.objectContaining({ id: agenda, text: 'Agenda, final' }),
    )
    expect(snapshot().can({ type: 'organisation.notes.save-button', id: agenda, text: '' })).toBe(
      false,
    )
    expect(emitted).toEqual([toast('note-updated')])
  })

  it('closes the open edit form when another note is deleted, and says the deletion in a toast', async () => {
    const { actor, deps, region, emitted } = page()

    actor.send({ type: 'organisation.notes.edit-button', id: hello })
    actor.send({ type: 'organisation.notes.delete-button', id: agenda })
    await region('note-items', 'idle')

    expect(deps.deleteNote).toHaveBeenCalledWith(agenda)
    expect(emitted).toEqual([toast('note-deleted')])
  })

  it('keeps the edit form open with the code of a refused save, and forgets it once a change of a note is done', async () => {
    const { actor, snapshot, region, emitted } = page({
      editNote: () => refused('note:FORBIDDEN'),
    })

    actor.send({ type: 'organisation.notes.edit-button', id: hello })
    actor.send({ type: 'organisation.notes.save-button', id: hello, text: 'Hello, all' })
    await region('note-items', 'editing')

    expect(snapshot().context.errors.codes).toEqual({ notes: 'note:FORBIDDEN' })

    actor.send({ type: 'organisation.notes.add-button', text: 'Plans' })
    await region('notes-add', 'idle')

    expect(snapshot().context.errors.codes.notes).toBeUndefined()
    expect(emitted).toEqual([toast('note-created')])
  })

  it('toasts an invitation and a removal, reading the members again after each', async () => {
    const { actor, deps, snapshot, emitted, region } = page()

    actor.send({ type: 'organisation.invite.submit-button', email: 'bea@example.test' })
    await region('invite', 'idle')

    expect(deps.invite).toHaveBeenCalledWith('bea@example.test')
    expect(emitted).toEqual([toast('invited')])
    expect(snapshot().context.membersChanged).toBe(1)

    actor.send({ type: 'organisation.members.remove-button', identity: bea })
    await region('members', 'idle')

    expect(deps.remove).toHaveBeenCalledWith(bea)
    expect(emitted.slice(1)).toEqual([toast('member-removed')])
    expect(snapshot().context.membersChanged).toBe(2)
  })

  it('shows a refused invitation or removal under the invitation', async () => {
    const { actor, snapshot, emitted, region } = page({
      invite: () => refused('already-member'),
      remove: () => refused('not-admin'),
    })

    actor.send({ type: 'organisation.invite.submit-button', email: 'bea@example.test' })
    await region('invite', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'already-member' })

    actor.send({ type: 'organisation.members.remove-button', identity: bea })
    await region('members', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'not-admin' })
    expect(snapshot().context.membersChanged).toBe(0)
    expect(emitted).toEqual([])
  })

  it('keeps the errors of the organisation they were refused in', async () => {
    const { actor, snapshot, becomes, region } = page({
      addNote: () => refused('failed'),
      invite: () => refused('already-member'),
    })

    actor.send({ type: 'organisation.notes.add-button', text: 'Plans' })
    await region('notes-add', 'idle')

    expect(snapshot().context.errors.of).toBe('acme')

    becomes('globex')
    actor.send({ type: 'organisation.invite.submit-button', email: 'bea@example.test' })
    await region('invite', 'idle')

    expect(snapshot().context.errors).toEqual({
      of: 'globex',
      codes: { members: 'already-member' },
    })
  })

  it('keeps a late outcome of a write away from the organisation that became current meanwhile', async () => {
    const invite = later()
    const { actor, snapshot, becomes, region } = page({
      invite: () => invite.result,
      remove: () => refused('not-admin'),
    })

    actor.send({ type: 'organisation.invite.submit-button', email: 'bea@example.test' })
    becomes('globex')
    actor.send({ type: 'organisation.members.remove-button', identity: bea })
    await region('members', 'idle')

    expect(snapshot().context.errors).toEqual({ of: 'globex', codes: { members: 'not-admin' } })

    invite.done()
    await region('invite', 'idle')

    expect(snapshot().context.errors).toEqual({ of: 'globex', codes: { members: 'not-admin' } })
  })

  it('shows no late failure of a write in the organisation that became current meanwhile', async () => {
    const invite = later()
    const { actor, snapshot, becomes, region } = page({
      invite: () => invite.result,
      addNote: () => refused('failed'),
    })

    actor.send({ type: 'organisation.invite.submit-button', email: 'bea@example.test' })
    becomes('globex')
    actor.send({ type: 'organisation.notes.add-button', text: 'Plans' })
    await region('notes-add', 'idle')
    invite.refuse('already-member')
    await region('invite', 'idle')

    expect(snapshot().context.errors).toEqual({ of: 'globex', codes: { notes: 'failed' } })
  })

  it('makes the chosen organisation current and starts every area afresh', async () => {
    const { actor, deps, snapshot, viewing } = page({ addNote: () => refused('failed') })

    actor.send({ type: 'organisation.create.toggle-button' })
    actor.send({ type: 'organisation.notes.add-button', text: 'Plans' })
    await waitFor(actor, (state) => state.context.errors.codes.notes !== undefined)

    actor.send({ type: 'organisation.page.current-select', key: 'globex' })

    expect(snapshot().can({ type: 'organisation.create.toggle-button' })).toBe(false)

    await viewing()

    expect(deps.select).toHaveBeenCalledWith('globex')
    expect(snapshot().matches({ viewing: { 'create-form': 'closed' } })).toBe(true)
    expect(snapshot().context.errors).toEqual({ of: undefined, codes: {} })
  })
})
