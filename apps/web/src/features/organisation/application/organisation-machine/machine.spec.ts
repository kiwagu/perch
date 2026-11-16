import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { BusError } from '@workspace/cqrs'
import { identityIdFactory, invitationIdFactory, noteIdFactory } from '@workspace/ids'

import { createOrganisationMachine, type OrganisationMachineDeps } from '.'

const hello = noteIdFactory.create()
const agenda = noteIdFactory.create()
const bea = identityIdFactory.create()
const ann = identityIdFactory.create()
const cy = identityIdFactory.create()
const toBea = invitationIdFactory.create()

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
    setRole: vi.fn(() => okAsync(undefined)),
    remove: vi.fn(() => okAsync(undefined)),
    revoke: vi.fn(() => okAsync(undefined)),
    copy: vi.fn(() => okAsync(undefined)),
    accept: vi.fn(() => okAsync(undefined)),
    decline: vi.fn(() => okAsync(undefined)),
    account: () => ann,
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

  it('invites with a role: the invitation toasts, both fields empty and the invitations are read again', async () => {
    const { actor, deps, snapshot, emitted, region } = page()

    actor.send({
      type: 'organisation.invite.submit-button',
      email: 'bea@example.test',
      role: 'admin',
    })
    await region('invite', 'idle')

    expect(deps.invite).toHaveBeenCalledWith('bea@example.test', 'admin')
    expect(emitted).toEqual([
      { type: 'clear', anchor: 'organisation.invite.email-input' },
      { type: 'clear', anchor: 'organisation.invite.role-select' },
      toast('invited'),
    ])
    expect(snapshot().context.invitationsChanged).toBe(1)
    expect(snapshot().context.membersChanged).toBe(0)
  })

  it('empties the form only while the organisation an invitation was sent in is current', async () => {
    const invite = later()
    const { actor, snapshot, emitted, becomes, region } = page({ invite: () => invite.result })

    actor.send({
      type: 'organisation.invite.submit-button',
      email: 'bea@example.test',
      role: 'admin',
    })
    // Another organisation becomes current without the page choosing it, and its form is typed in.
    becomes('globex')
    invite.done()
    await region('invite', 'idle')

    expect(emitted).toEqual([toast('invited')])
    expect(snapshot().context.invitationsChanged).toBe(1)
  })

  it('toasts a removal, reading the members again', async () => {
    const { actor, deps, snapshot, emitted, region } = page()

    actor.send({ type: 'organisation.members.remove-button', identity: bea })
    await region('members', 'idle')

    expect(deps.remove).toHaveBeenCalledWith(bea)
    expect(emitted).toEqual([toast('member-removed')])
    expect(snapshot().context.membersChanged).toBe(1)
    expect(snapshot().context.invitationsChanged).toBe(0)
  })

  it('shows a refused invitation or removal under the invitation', async () => {
    const { actor, snapshot, emitted, region } = page({
      invite: () => refused('already-member'),
      remove: () => refused('not-admin'),
    })

    actor.send({
      type: 'organisation.invite.submit-button',
      email: 'bea@example.test',
      role: 'member',
    })
    await region('invite', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'already-member' })

    actor.send({ type: 'organisation.members.remove-button', identity: bea })
    await region('members', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'not-admin' })
    expect(snapshot().context.membersChanged).toBe(0)
    expect(snapshot().context.invitationsChanged).toBe(0)
    expect(emitted).toEqual([])
  })

  it('changes one role at a time, showing the role being set, then toasts and reads the members again', async () => {
    const change = later()
    const { actor, deps, snapshot, emitted, region } = page({ setRole: vi.fn(() => change.result) })

    actor.send({ type: 'organisation.members.role-select', identity: bea, role: 'admin' })

    expect(snapshot().context.changingRole).toEqual({ identity: bea, role: 'admin', of: 'acme' })
    expect(
      snapshot().can({ type: 'organisation.members.role-select', identity: ann, role: 'member' }),
    ).toBe(false)

    change.done()
    await region('member-roles', 'idle')

    expect(deps.setRole).toHaveBeenCalledWith({ identity: bea, role: 'admin' })
    expect(emitted).toEqual([toast('role-changed')])
    expect(snapshot().context.membersChanged).toBe(1)
    expect(snapshot().context.changingRole).toBeUndefined()
    expect(
      snapshot().can({ type: 'organisation.members.role-select', identity: ann, role: 'member' }),
    ).toBe(true)
  })

  it('remembers a role set, with the read of the members that confirms it, until another is set on its row', async () => {
    const { actor, snapshot, region } = page()

    actor.send({ type: 'organisation.members.role-select', identity: bea, role: 'admin' })
    await region('member-roles', 'idle')

    expect(snapshot().context.changingRole).toBeUndefined()
    expect(snapshot().context.rolesSet).toEqual([
      { identity: bea, role: 'admin', read: 1, of: 'acme' },
    ])

    actor.send({ type: 'organisation.members.role-select', identity: cy, role: 'admin' })
    await region('member-roles', 'idle')

    expect(snapshot().context.rolesSet).toEqual([
      { identity: bea, role: 'admin', read: 1, of: 'acme' },
      { identity: cy, role: 'admin', read: 2, of: 'acme' },
    ])

    actor.send({ type: 'organisation.members.role-select', identity: bea, role: 'member' })
    await region('member-roles', 'idle')

    expect(snapshot().context.rolesSet).toEqual([
      { identity: cy, role: 'admin', read: 2, of: 'acme' },
      { identity: bea, role: 'member', read: 3, of: 'acme' },
    ])
  })

  it('keeps the role set before when the next change of the row is refused', async () => {
    let refuse = false
    const { actor, snapshot, region } = page({
      setRole: () => (refuse ? refused('not-admin') : okAsync(undefined)),
    })

    actor.send({ type: 'organisation.members.role-select', identity: bea, role: 'admin' })
    await region('member-roles', 'idle')

    refuse = true
    actor.send({ type: 'organisation.members.role-select', identity: bea, role: 'member' })
    await region('member-roles', 'idle')

    expect(snapshot().context.changingRole).toBeUndefined()
    expect(snapshot().context.rolesSet).toEqual([
      { identity: bea, role: 'admin', read: 1, of: 'acme' },
    ])
  })

  it('does not read the members again after the account demoted itself', async () => {
    const { actor, snapshot, emitted, region } = page()

    actor.send({ type: 'organisation.members.role-select', identity: ann, role: 'member' })
    await region('member-roles', 'idle')

    expect(emitted).toEqual([toast('role-changed')])
    expect(snapshot().context.membersChanged).toBe(0)
    expect(snapshot().context.changingRole).toBeUndefined()
    expect(snapshot().context.rolesSet).toEqual([])
  })

  it('remembers no role set in an organisation that is no longer current', async () => {
    const change = later()
    const { actor, snapshot, becomes, region } = page({ setRole: vi.fn(() => change.result) })

    actor.send({ type: 'organisation.members.role-select', identity: bea, role: 'admin' })
    becomes('globex')
    change.done()
    await region('member-roles', 'idle')

    expect(snapshot().context.rolesSet).toEqual([])
  })

  it('shows a refused role change under the invitation and lets the select show the role kept', async () => {
    const { actor, snapshot, emitted, region } = page({ setRole: () => refused('last-admin') })

    actor.send({ type: 'organisation.members.role-select', identity: ann, role: 'member' })
    await region('member-roles', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'last-admin' })
    expect(snapshot().context.changingRole).toBeUndefined()
    expect(snapshot().context.rolesSet).toEqual([])
    expect(snapshot().context.membersChanged).toBe(0)
    expect(emitted).toEqual([])
  })

  it('puts the link of an invitation on the clipboard and toasts, or shows a refused clipboard as it is', async () => {
    let refuse = false
    const { actor, deps, snapshot, emitted, region } = page({
      copy: vi.fn(() => (refuse ? refused('clipboard:REFUSED') : okAsync(undefined))),
    })

    actor.send({ type: 'organisation.sent.copy-button', invitation: toBea })
    await region('sent-copy', 'idle')

    expect(deps.copy).toHaveBeenCalledWith(toBea)
    expect(emitted).toEqual([toast('link-copied')])
    expect(snapshot().context.invitationsChanged).toBe(0)

    refuse = true
    actor.send({ type: 'organisation.sent.copy-button', invitation: toBea })
    await region('sent-copy', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'clipboard:REFUSED' })
    expect(emitted).toHaveLength(1)
  })

  it('revokes an invitation, toasts and reads the invitations again; a refusal shows under the invitation', async () => {
    let refuse = false
    const { actor, deps, snapshot, emitted, region } = page({
      revoke: vi.fn(() => (refuse ? refused('not-admin') : okAsync(undefined))),
    })

    actor.send({ type: 'organisation.sent.revoke-button', invitation: toBea })
    await region('sent-revoke', 'idle')

    expect(deps.revoke).toHaveBeenCalledWith(toBea)
    expect(emitted).toEqual([toast('invitation-revoked')])
    expect(snapshot().context.invitationsChanged).toBe(1)

    refuse = true
    actor.send({ type: 'organisation.sent.revoke-button', invitation: toBea })
    await region('sent-revoke', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ members: 'not-admin' })
    expect(snapshot().context.invitationsChanged).toBe(1)
    expect(emitted).toHaveLength(1)
  })

  it('accepts an invitation: it toasts, reads the invitations again and starts every area afresh', async () => {
    const { actor, deps, snapshot, emitted, viewing } = page({
      addNote: () => refused('failed'),
    })

    actor.send({ type: 'organisation.create.toggle-button' })
    actor.send({ type: 'organisation.notes.edit-button', id: hello })
    actor.send({ type: 'organisation.notes.add-button', text: 'Plans' })
    await waitFor(actor, (state) => state.context.errors.codes.notes !== undefined)

    actor.send({ type: 'organisation.received.accept-button', invitation: toBea })
    await viewing()
    await waitFor(actor, (state) => state.matches({ viewing: { received: 'idle' } }))

    expect(deps.accept).toHaveBeenCalledWith(toBea)
    expect(emitted).toEqual([toast('invitation-accepted')])
    expect(snapshot().context.receivedChanged).toBe(1)
    expect(snapshot().context.errors).toEqual({ of: undefined, codes: {} })
    expect(snapshot().context.editing).toBeUndefined()
    expect(snapshot().matches({ viewing: { 'create-form': 'closed' } })).toBe(true)
  })

  it('shows a refused acceptance on the invitations for the account, reads them again, and takes the next one', async () => {
    let refuse = true
    const { actor, snapshot, emitted, region } = page({
      accept: () => (refuse ? refused('invitation-gone') : okAsync(undefined)),
    })

    actor.send({ type: 'organisation.received.accept-button', invitation: toBea })
    await region('received', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ received: 'invitation-gone' })
    expect(snapshot().context.receivedChanged).toBe(1)
    expect(emitted).toEqual([])

    refuse = false
    actor.send({ type: 'organisation.received.accept-button', invitation: toBea })
    await waitFor(actor, (state) => state.context.receivedChanged === 2)

    expect(snapshot().context.errors).toEqual({ of: undefined, codes: {} })
  })

  it('declines an invitation, toasts and reads the invitations for the account again; a refusal shows there and reads them again', async () => {
    let refuse = false
    const { actor, deps, snapshot, emitted, region } = page({
      decline: vi.fn(() => (refuse ? refused('other-account') : okAsync(undefined))),
    })

    actor.send({ type: 'organisation.received.decline-button', invitation: toBea })
    await region('received-decline', 'idle')

    expect(deps.decline).toHaveBeenCalledWith(toBea)
    expect(emitted).toEqual([toast('invitation-declined')])
    expect(snapshot().context.receivedChanged).toBe(1)
    expect(snapshot().matches({ viewing: { received: 'idle' } })).toBe(true)

    refuse = true
    actor.send({ type: 'organisation.received.decline-button', invitation: toBea })
    await region('received-decline', 'idle')

    expect(snapshot().context.errors.codes).toEqual({ received: 'other-account' })
    expect(snapshot().context.receivedChanged).toBe(2)
    expect(emitted).toHaveLength(1)
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
    actor.send({
      type: 'organisation.invite.submit-button',
      email: 'bea@example.test',
      role: 'member',
    })
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

    actor.send({
      type: 'organisation.invite.submit-button',
      email: 'bea@example.test',
      role: 'member',
    })
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

    actor.send({
      type: 'organisation.invite.submit-button',
      email: 'bea@example.test',
      role: 'member',
    })
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
