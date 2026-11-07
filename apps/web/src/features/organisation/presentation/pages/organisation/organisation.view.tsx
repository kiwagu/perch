import { Fragment } from 'react'

import { useT } from '@workspace/i18n'
import type { IdentityId, InvitationId, NoteId } from '@workspace/ids'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type {
  OrganisationErrors,
  OrganisationEvent,
  TenantRole,
} from '../../../application/organisation-machine'
import { OrganisationCreate } from '../../components/organisation-create/organisation-create.view'
import {
  type InviteDraft,
  OrganisationInvite,
} from '../../components/organisation-invite/organisation-invite.view'
import {
  type MemberItem,
  OrganisationMembers,
} from '../../components/organisation-members/organisation-members.view'
import {
  type NoteItem,
  OrganisationNotes,
} from '../../components/organisation-notes/organisation-notes.view'
import {
  OrganisationReceived,
  type ReceivedItem,
} from '../../components/organisation-received/organisation-received.view'
import {
  OrganisationSent,
  type SentItem,
} from '../../components/organisation-sent/organisation-sent.view'
import { roleLabel } from '../../components/role-words'

export type { InviteDraft, MemberItem, NoteItem, OrganisationErrors, ReceivedItem, SentItem }

/** An organisation the signed-in identity belongs to, with its role there. */
export interface OrganisationChoice {
  readonly key: string
  readonly name: string
  readonly role: 'member' | 'admin'
}

export interface OrganisationViewProps {
  readonly organisations: readonly OrganisationChoice[]
  /** The organisation the notes are read from and written to; none without memberships. */
  readonly current: OrganisationChoice | undefined
  /** The current organisation's notes, oldest first; undefined until they are read. */
  readonly notes: readonly NoteItem[] | undefined
  /** The current organisation's members, shown to an administrator; undefined until they are read. */
  readonly members?: readonly MemberItem[] | undefined
  /** The current organisation's invitations not accepted yet, shown to an administrator; undefined until read. */
  readonly sent?: readonly SentItem[] | undefined
  /** The invitations to the account's email, in every state; undefined until they are read. */
  readonly received?: readonly ReceivedItem[] | undefined
  readonly errors?: OrganisationErrors
  /** Whether the page's flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: OrganisationEvent) => boolean
  /** The create form is open: its toggle opened it, or a creation from it runs. */
  readonly creating: boolean
  /** The note whose edit form is shown; none while no note is edited. */
  readonly editing: NoteId | undefined
  readonly onToggleCreate: () => void
  /** The actions of the forms resolve true once done, and the form that asked starts afresh. */
  readonly onCreate: (input: { readonly key: string; readonly name: string }) => Promise<boolean>
  readonly onSelect: (key: string) => void
  readonly onAddNote: (text: string) => Promise<boolean>
  readonly onOpenEdit: (id: NoteId) => void
  readonly onEditNote: (input: { readonly id: NoteId; readonly text: string }) => Promise<boolean>
  readonly onDeleteNote: (id: NoteId) => void
  /** What the invitation form's fields hold, and a change of them. */
  readonly invite: InviteDraft
  readonly onInviteChange: (draft: InviteDraft) => void
  readonly onInvite: (email: string, role: TenantRole) => Promise<boolean>
  readonly onSetRole: (id: IdentityId, role: TenantRole) => void
  readonly onRemoveMember: (id: IdentityId) => void
  readonly onCopy: (id: InvitationId) => void
  readonly onRevoke: (id: InvitationId) => void
  readonly onAccept: (id: InvitationId) => void
  readonly onDecline: (id: InvitationId) => void
}

function OrganisationHeader(props: {
  readonly current: OrganisationChoice
  readonly organisations: readonly OrganisationChoice[]
  readonly can: OrganisationViewProps['can']
  readonly onSelect: (key: string) => void
}) {
  const t = useT()
  const { current } = props

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 data-testid="organisation.page.heading">{current.name}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p
          className="text-sm text-muted-foreground"
          data-testid="organisation.page.role-badge"
          data-value={current.role}
        >
          {roleLabel(t, current.role)}
        </p>
        {props.organisations.length > 1 ? (
          <OptionSelect
            label={t('organisation.select')}
            value={current.key}
            options={props.organisations.map(({ key, name }) => ({
              value: key,
              label: name,
            }))}
            onChange={props.onSelect}
            disabled={!props.can({ type: 'organisation.page.current-select', key: current.key })}
            testId="organisation.page.current-select"
            holdsInput={false}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * The organisation page: without memberships, a way to create the first organisation; with
 * them, the current organisation's notes for every member, and its members and invitations for
 * an administrator; with memberships none of whose databases opened on this device, a line that
 * says so. The invitations for the account show in every state, above the create form.
 */
export function OrganisationView(props: OrganisationViewProps) {
  const t = useT()
  const { current } = props
  const unavailable = props.organisations.length > 0

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {current ? (
        <>
          <OrganisationHeader
            current={current}
            organisations={props.organisations}
            can={props.can}
            onSelect={props.onSelect}
          />
          {/* The forms' drafts belong to their organisation: another organisation starts afresh. */}
          <Fragment key={current.key}>
            <OrganisationNotes
              notes={props.notes}
              editing={props.editing}
              error={props.errors?.notes}
              can={props.can}
              onAdd={props.onAddNote}
              onOpenEdit={props.onOpenEdit}
              onEdit={props.onEditNote}
              onDelete={props.onDeleteNote}
            />
            {current.role === 'admin' ? (
              <>
                <OrganisationMembers
                  members={props.members}
                  can={props.can}
                  onSetRole={props.onSetRole}
                  onRemove={props.onRemoveMember}
                >
                  <OrganisationInvite
                    draft={props.invite}
                    error={props.errors?.members}
                    can={props.can}
                    onChange={props.onInviteChange}
                    onInvite={props.onInvite}
                  />
                </OrganisationMembers>
                <OrganisationSent
                  invitations={props.sent}
                  can={props.can}
                  onCopy={props.onCopy}
                  onRevoke={props.onRevoke}
                />
              </>
            ) : null}
          </Fragment>
        </>
      ) : (
        // No membership, or memberships none of whose databases opened on this device.
        <p
          className="text-muted-foreground"
          role="status"
          data-testid="organisation.page.status"
          data-state={unavailable ? 'error' : 'empty'}
        >
          {unavailable ? t('organisation.unavailable') : t('organisation.none')}
        </p>
      )}
      <OrganisationReceived
        invitations={props.received}
        error={props.errors?.received}
        can={props.can}
        onAccept={props.onAccept}
        onDecline={props.onDecline}
      />
      {current ? (
        <Button
          type="button"
          variant="outline"
          aria-expanded={props.creating}
          disabled={!props.can({ type: 'organisation.create.toggle-button' })}
          onClick={props.onToggleCreate}
          data-testid="organisation.create.toggle-button"
        >
          {t('organisation.create.toggle')}
        </Button>
      ) : null}
      {/* Closed, the create form is hidden and keeps what was typed; another organisation starts it afresh. */}
      <div key={current?.key ?? ''} hidden={current !== undefined && !props.creating}>
        <OrganisationCreate
          error={props.errors?.create}
          can={props.can}
          onCreate={props.onCreate}
        />
      </div>
    </div>
  )
}
