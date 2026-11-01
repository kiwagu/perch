import { Fragment } from 'react'

import { useT } from '@workspace/i18n'
import type { IdentityId, NoteId } from '@workspace/ids'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type {
  OrganisationErrors,
  OrganisationEvent,
} from '../../../application/organisation.machine'
import { OrganisationCreate } from '../../components/organisation-create/organisation-create.view'
import {
  type MemberItem,
  OrganisationMembers,
} from '../../components/organisation-members/organisation-members.view'
import {
  type NoteItem,
  OrganisationNotes,
} from '../../components/organisation-notes/organisation-notes.view'

export type { MemberItem, NoteItem, OrganisationErrors }

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
  readonly onInvite: (email: string) => Promise<boolean>
  readonly onRemoveMember: (id: IdentityId) => void
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
          {t(current.role === 'admin' ? 'organisation.role.admin' : 'organisation.role.member')}
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
 * them, the current organisation's notes for every member, and its members for an administrator;
 * with memberships none of whose databases opened on this device, a line that says so.
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
              <OrganisationMembers
                members={props.members}
                error={props.errors?.members}
                can={props.can}
                onInvite={props.onInvite}
                onRemove={props.onRemoveMember}
              />
            ) : null}
          </Fragment>
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
