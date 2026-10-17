import type { ResultAsync } from 'neverthrow'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import type { BusError } from '@workspace/cqrs'
import { useT } from '@workspace/i18n'
import type { IdentityId, NoteId } from '@workspace/ids'
import { ownerKeyOf } from '@workspace/kernel'

import { useService, useShape } from '../../../../../platform/module'
import { useNotify } from '../../../../../platform/notices'
import type { MemberView } from '../../../../../platform/organisations.port'
import { SESSION } from '../../../../../platform/session.port'
import { NOTES_SERVICE } from '../../../application/notes.service'
import { ORGANISATION_SERVICE } from '../../../application/organisation.service'

import { organisationShape } from './organisation.model.gen'
import {
  type OrganisationChoice,
  type OrganisationErrors,
  OrganisationView,
} from './organisation.view'

const choice = (membership: {
  readonly tenant: { readonly key: string; readonly name: string }
  readonly role: OrganisationChoice['role']
}): OrganisationChoice => ({
  key: membership.tenant.key,
  name: membership.tenant.name,
  role: membership.role,
})

/** The codes of the refused changes, and the organisation they were refused for. */
interface PageErrors {
  readonly key: string | undefined
  readonly codes: OrganisationErrors
}

/** The page's errors with `code` for `part`, while they are still those of organisation `of`. */
const withError =
  (part: keyof OrganisationErrors, code: string | undefined, of: string | undefined) =>
  (now: PageErrors): PageErrors =>
    now.key === of ? { key: of, codes: { ...now.codes, [part]: code } } : now

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
  const admin = current?.role === 'admin'
  // What the page shows of one organisation starts afresh when another becomes current.
  const [errors, setErrors] = useState<PageErrors>({ key, codes: {} })
  const [members, setMembers] = useState<
    { readonly key: string; readonly list: readonly MemberView[] } | undefined
  >(undefined)
  const [membersRead, setMembersRead] = useState(0)
  const notify = useNotify()
  const t = useT()

  // Adjusting state while rendering: React renders again at once, before anything is shown.
  if (errors.key !== key) {
    setErrors({ key, codes: {} })
  }

  const report = (part: keyof OrganisationErrors, code: string | undefined, of = key) =>
    setErrors(withError(part, code, of))

  // An administrator sees the members: read when the page opens and after each invite or removal.
  useEffect(() => {
    if (key === undefined || !admin) {
      return undefined
    }

    let live = true

    void organisations.members(key).match(
      (list) => {
        if (live) {
          setMembers({ key, list })
        }
      },
      (failure) => {
        if (live) {
          setErrors(withError('members', failure.code, key))
        }
      },
    )

    return () => {
      live = false
    }
  }, [organisations, key, admin, membersRead])

  const create = (input: { readonly key: string; readonly name: string }) =>
    organisations.create(input).match(
      () => {
        report('create', undefined)

        return true
      },
      (failure) => {
        report('create', failure.code)

        return false
      },
    )

  const noteDone = (write: ResultAsync<void, BusError>) =>
    write.match(
      () => {
        report('notes', undefined)

        return true
      },
      (failure) => {
        report('notes', failure.code)

        return false
      },
    )

  const addNote = (text: string) =>
    user ? noteDone(notes.add({ author: user.id, text })) : Promise.resolve(false)

  const editNote = (input: { readonly id: NoteId; readonly text: string }) =>
    noteDone(notes.edit(input))

  const deleteNote = (id: NoteId) => noteDone(notes.remove({ id }))

  const invite = (email: string) =>
    key === undefined
      ? Promise.resolve(false)
      : organisations.invite(key, email).match(
          () => {
            report('members', undefined, key)
            notify({ testId: 'organisation.invite.notice', text: t('organisation.invite.invited') })
            setMembersRead((count) => count + 1)

            return true
          },
          (failure) => {
            report('members', failure.code, key)

            return false
          },
        )

  const removeMember = (identity: IdentityId) => {
    if (key === undefined) {
      return
    }

    void organisations.remove(key, identity).match(
      () => {
        report('members', undefined, key)
        setMembersRead((count) => count + 1)
      },
      (failure) => report('members', failure.code, key),
    )
  }

  return (
    <OrganisationView
      organisations={memberships.map(choice)}
      current={current ? choice(current) : undefined}
      notes={items}
      members={
        members && members.key === key
          ? members.list.map((member) => ({
              id: member.identity.id,
              email: member.identity.email,
              removable: member.identity.id !== user?.id,
            }))
          : undefined
      }
      errors={errors.key === key ? errors.codes : {}}
      onCreate={create}
      onSelect={(next) => organisations.select(next)}
      onAddNote={addNote}
      onEditNote={editNote}
      onDeleteNote={deleteNote}
      onInvite={invite}
      onRemoveMember={removeMember}
    />
  )
}
