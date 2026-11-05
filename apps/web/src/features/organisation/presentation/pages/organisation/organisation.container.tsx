import { errAsync } from 'neverthrow'
import { useMemo, useSyncExternalStore } from 'react'

import type { BusError } from '@workspace/cqrs'
import { ownerKeyOf } from '@workspace/kernel'

import { useService, useShape } from '../../../../../platform/module'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { NOTES_SERVICE } from '../../../application/notes.service'
import { createOrganisationMachine } from '../../../application/organisation.machine'
import { ORGANISATION_SERVICE } from '../../../application/organisation.service'

import { organisationShape } from './organisation.model.gen'
import { type OrganisationChoice, OrganisationView } from './organisation.view'
import { useMembers } from './use-members'

const choice = (membership: {
  readonly tenant: { readonly key: string; readonly name: string }
  readonly role: OrganisationChoice['role']
}): OrganisationChoice => ({
  key: membership.tenant.key,
  name: membership.tenant.name,
  role: membership.role,
})

/** A write the page asks for while no organisation is current, or no one is signed in. */
const NOT_NOW: BusError = {
  code: 'organisation:UNAVAILABLE',
  message: 'no organisation is current, or no one is signed in',
}

export function OrganisationContainer() {
  const session = useService(SESSION)
  const organisations = useService(ORGANISATION_SERVICE)
  const notes = useService(NOTES_SERVICE)
  const user = useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.current(),
  )
  const memberships = useSyncExternalStore(
    (onChange) => organisations.subscribe(onChange),
    () => organisations.memberships(),
  )
  const current = useSyncExternalStore(
    (onChange) => organisations.subscribe(onChange),
    () => organisations.current(),
  )
  // The runner follows the organisation that becomes current; no organisation, nothing to read.
  const { tree } = useShape(organisationShape, current ? {} : null)
  const ability = useMemo(() => organisations.ability(), [organisations, user, current])
  const items = tree?.map((note) => ({
    id: note.id,
    text: note.text,
    mine: user !== undefined && ownerKeyOf(note.author) === user.id,
    editable: ability.can('update', 'note', note),
    deletable: ability.can('delete', 'note', note),
  }))
  const key = current?.tenant.key
  // Each write reads the organisation current, and the account signed in, when it runs.
  const machine = useMemo(() => {
    const at = () => organisations.current()?.tenant.key

    return createOrganisationMachine({
      select: (next) => organisations.select(next),
      create: (input) => organisations.create(input),
      addNote: (text) => {
        const author = session.current()?.id

        return author === undefined ? errAsync(NOT_NOW) : notes.add({ author, text })
      },
      editNote: (input) => notes.edit(input),
      deleteNote: (id) => notes.remove({ id }),
      invite: (email) => {
        const organisation = at()

        return organisation === undefined
          ? errAsync(NOT_NOW)
          : organisations.invite(organisation, email)
      },
      remove: (identity) => {
        const organisation = at()

        return organisation === undefined
          ? errAsync(NOT_NOW)
          : organisations.remove(organisation, identity)
      },
      current: at,
    })
  }, [organisations, notes, session])
  const { state, send, submit, renders } = useScreenMachine('organisation', machine)
  // An administrator sees the members: read when the page opens and after each change made here.
  const members = useMembers(
    organisations,
    current?.role === 'admin' ? key : undefined,
    state.context.membersChanged,
  )
  const { errors } = state.context
  const shown = errors.of === key ? errors.codes : {}
  // The note being edited shows its text area while the state renders it.
  const editing = renders('organisation.notes.edit-textarea')

  return (
    <OrganisationView
      organisations={memberships.map(choice)}
      current={current ? choice(current) : undefined}
      notes={items}
      members={members.list?.map((member) => ({
        id: member.identity.id,
        email: member.identity.email,
        removable: member.identity.id !== user?.id,
      }))}
      errors={{ ...shown, members: shown.members ?? members.failure }}
      can={(event) => state.can(event)}
      creating={
        state.matches({ viewing: { 'create-form': 'open' } }) ||
        state.matches({ viewing: { 'create-form': 'submitting' } })
      }
      editing={editing ? state.context.editing : undefined}
      onToggleCreate={() => send({ type: 'organisation.create.toggle-button' })}
      onCreate={(input) => submit({ type: 'organisation.create.submit-button', ...input })}
      // A switch of organisation leaves what was typed for this one: the hook asks the frame first.
      onSelect={(next) => send({ type: 'organisation.page.current-select', key: next })}
      onAddNote={(text) => submit({ type: 'organisation.notes.add-button', text })}
      onOpenEdit={(id) => send({ type: 'organisation.notes.edit-button', id })}
      onEditNote={(input) => submit({ type: 'organisation.notes.save-button', ...input })}
      onDeleteNote={(id) => send({ type: 'organisation.notes.delete-button', id })}
      onInvite={(email) => submit({ type: 'organisation.invite.submit-button', email })}
      onRemoveMember={(identity) => send({ type: 'organisation.members.remove-button', identity })}
    />
  )
}
