import { errAsync, type ResultAsync } from 'neverthrow'
import { useMemo, useRef, useSyncExternalStore } from 'react'

import type { BusError } from '@workspace/cqrs'
import { ownerKeyOf } from '@workspace/kernel'

import { CLIPBOARD } from '../../../../../platform/clipboard.port'
import { useFieldClears } from '../../../../../platform/field-clears'
import { useService, useShape } from '../../../../../platform/module'
import type { InvitationView } from '../../../../../platform/organisations.port'
import { useScreenMachine } from '../../../../../platform/screen-machine'
import { SESSION } from '../../../../../platform/session.port'
import { NOTES_SERVICE } from '../../../application/notes.service'
import { ORGANISATION_SERVICE } from '../../../application/organisation.service'
import { createOrganisationMachine } from '../../../application/organisation-machine'

import { organisationShape } from './organisation.model.gen'
import { type OrganisationChoice, OrganisationView } from './organisation.view'
import { roleShown } from './role-shown'
import { useInviteDraft } from './use-invite-draft'
import { useListed } from './use-listed'

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

/** A copy of the link of an invitation the list does not hold (any more). */
const NO_LINK: BusError = {
  code: 'organisation:NO_LINK',
  message: 'the invitation is not among the invitations sent',
}

export function OrganisationContainer() {
  const session = useService(SESSION)
  const organisations = useService(ORGANISATION_SERVICE)
  const notes = useService(NOTES_SERVICE)
  const clipboard = useService(CLIPBOARD)
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
  const admin = current?.role === 'admin' ? key : undefined
  // The link a copy puts on the clipboard is the one the list shows now.
  const sent = useRef<readonly InvitationView[] | undefined>(undefined)
  // Each write reads the organisation current, and the account signed in, when it runs.
  const machine = useMemo(() => {
    const at = () => organisations.current()?.tenant.key
    const inOrganisation = <T,>(run: (organisation: string) => ResultAsync<T, BusError>) => {
      const organisation = at()

      return organisation === undefined ? errAsync(NOT_NOW) : run(organisation)
    }

    return createOrganisationMachine({
      select: (next) => organisations.select(next),
      create: (input) => organisations.create(input),
      addNote: (text) => {
        const author = session.current()?.id

        return author === undefined ? errAsync(NOT_NOW) : notes.add({ author, text })
      },
      editNote: (input) => notes.edit(input),
      deleteNote: (id) => notes.remove({ id }),
      invite: (email, role) =>
        inOrganisation((organisation) => organisations.invite(organisation, email, role)),
      setRole: ({ identity, role }) =>
        inOrganisation((organisation) => organisations.setRole(organisation, identity, role)),
      remove: (identity) =>
        inOrganisation((organisation) => organisations.remove(organisation, identity)),
      revoke: (invitation) =>
        inOrganisation((organisation) => organisations.revokeInvitation(organisation, invitation)),
      copy: (invitation) => {
        const link = sent.current?.find((each) => each.id === invitation)?.link

        return link === undefined ? errAsync(NO_LINK) : clipboard.write(link)
      },
      accept: (invitation) => organisations.accept(invitation),
      decline: (invitation) => organisations.decline(invitation),
      account: () => session.current()?.id,
      current: at,
    })
  }, [organisations, notes, session, clipboard])
  const { state, send, submit, renders, actor } = useScreenMachine('organisation', machine)
  // An administrator sees the members and the invitations sent, and the account the invitations
  // for it: each is read when it starts to show and after each change made here.
  const members = useListed(
    (organisation) => organisations.members(organisation),
    admin,
    state.context.membersChanged,
  )
  const invitations = useListed(
    (organisation) => organisations.invitations(organisation),
    admin,
    state.context.invitationsChanged,
  )
  const received = useListed(
    () => organisations.received(),
    user?.id,
    state.context.receivedChanged,
  )

  sent.current = invitations.list
  // The invitation form empties as the flow says once an invitation is sent.
  const invite = useInviteDraft(key)

  useFieldClears(actor, {
    'organisation.invite.email-input': invite.clearEmail,
    'organisation.invite.role-select': invite.clearRole,
  })

  const { errors, changingRole, rolesSet } = state.context
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
        // The row shows the role being set while its change runs, and the one just set until the
        // members read after it settle; the listed one otherwise.
        role: roleShown({
          identity: member.identity.id,
          listed: member.role,
          changing: changingRole,
          set: rolesSet,
          settled: members.settled,
        }),
        removable: member.identity.id !== user?.id,
      }))}
      sent={invitations.list}
      // A failed read shows in place of the list, even of one read before it.
      received={
        received.failure === undefined
          ? received.list?.map((invitation) => ({
              id: invitation.id,
              name: invitation.organisation.name,
              role: invitation.role,
            }))
          : undefined
      }
      errors={{
        ...shown,
        members: shown.members ?? members.failure ?? invitations.failure,
        // A failed read says why the list is missing, before an answer's refusal.
        received: received.failure ?? shown.received,
      }}
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
      invite={invite.draft}
      onInviteChange={invite.set}
      onInvite={(email, role) => submit({ type: 'organisation.invite.submit-button', email, role })}
      onSetRole={(identity, role) =>
        send({ type: 'organisation.members.role-select', identity, role })
      }
      onRemoveMember={(identity) => send({ type: 'organisation.members.remove-button', identity })}
      onCopy={(invitation) => send({ type: 'organisation.sent.copy-button', invitation })}
      onRevoke={(invitation) => send({ type: 'organisation.sent.revoke-button', invitation })}
      onAccept={(invitation) => send({ type: 'organisation.received.accept-button', invitation })}
      onDecline={(invitation) => send({ type: 'organisation.received.decline-button', invitation })}
    />
  )
}
