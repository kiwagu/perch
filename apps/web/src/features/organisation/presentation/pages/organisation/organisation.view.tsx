import { Fragment, type SubmitEvent, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import type { IdentityId, NoteId } from '@workspace/ids'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@workspace/ui/components/ui/field'
import { Input } from '@workspace/ui/components/ui/input'
import { Textarea } from '@workspace/ui/components/ui/textarea'

import { NOTE_TEXT_MAX } from '../../../domain/note.entity'

/** An organisation the signed-in identity belongs to, with its role there. */
export interface OrganisationChoice {
  readonly key: string
  readonly name: string
  readonly role: 'member' | 'admin'
}

export interface NoteItem {
  readonly id: NoteId
  readonly text: string
  /** The signed-in member wrote it. */
  readonly mine: boolean
  /** The rules let the signed-in member edit it. */
  readonly editable: boolean
  /** The rules let the signed-in member delete it. */
  readonly deletable: boolean
}

export interface MemberItem {
  readonly id: IdentityId
  readonly email: string
  /** An administrator removes any member but itself. */
  readonly removable: boolean
}

/** The codes of the last refused changes, by the part of the page that asked for them. */
export interface OrganisationErrors {
  readonly create?: string | undefined
  readonly notes?: string | undefined
  readonly members?: string | undefined
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
  /** The actions of the forms resolve true once done, and the form that asked starts afresh. */
  readonly onCreate: (input: { readonly key: string; readonly name: string }) => Promise<boolean>
  readonly onSelect: (key: string) => void
  readonly onAddNote: (text: string) => Promise<boolean>
  readonly onEditNote: (input: { readonly id: NoteId; readonly text: string }) => Promise<boolean>
  readonly onDeleteNote: (id: NoteId) => Promise<boolean>
  readonly onInvite: (email: string) => Promise<boolean>
  readonly onRemoveMember: (id: IdentityId) => void
}

function errorText(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'organisation:KEY_INVALID':
    case 'invalid-key':
      return t('organisation.error.key-invalid')
    case 'organisation:NAME_REQUIRED':
      return t('organisation.error.name-required')
    case 'organisation:NAME_TOO_LONG':
      return t('organisation.error.name-too-long')
    case 'key-taken':
      return t('organisation.error.key-taken')
    case 'no-such-identity':
      return t('organisation.error.no-such-identity')
    case 'already-member':
      return t('organisation.error.already-member')
    case 'not-admin':
      return t('organisation.error.not-admin')
    case 'note:FORBIDDEN':
      return t('organisation.error.forbidden')
    case 'note:TEXT_REQUIRED':
      return t('organisation.error.text-required')
    case 'note:TEXT_TOO_LONG':
      return t('organisation.error.text-too-long')
    default:
      return t('organisation.error.failed')
  }
}

/** Runs a form's action, one at a time: `pending` while it runs, then `after` hears whether it was done. */
function useAction(): readonly [
  boolean,
  (action: Promise<boolean>, after: (done: boolean) => void) => void,
] {
  const [pending, setPending] = useState(false)

  return [
    pending,
    (action, after) => {
      setPending(true)
      void action.then((done) => {
        setPending(false)
        after(done)
      })
    },
  ]
}

function ErrorLine(props: { readonly code: string | undefined; readonly testId: string }) {
  const t = useT()

  return props.code ? (
    <FieldError data-testid={props.testId}>{errorText(t, props.code)}</FieldError>
  ) : null
}

function CreateForm(props: {
  readonly error: string | undefined
  readonly onCreate: OrganisationViewProps['onCreate']
  readonly onCreated: () => void
}) {
  const t = useT()
  const keyId = useId()
  const nameId = useId()
  const hintId = useId()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [pending, run] = useAction()
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    run(props.onCreate({ key, name }), (done) => {
      if (done) {
        setKey('')
        setName('')
        props.onCreated()
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.create.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={keyId}>{t('organisation.create.key')}</FieldLabel>
              <Input
                id={keyId}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                autoCapitalize="none"
                autoComplete="off"
                aria-describedby={hintId}
                data-testid="organisation.create.key"
              />
              <FieldDescription id={hintId}>{t('organisation.create.key-hint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('organisation.create.name')}</FieldLabel>
              <Input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="organization"
                data-testid="organisation.create.name"
              />
            </Field>
            <Field data-invalid={props.error ? true : undefined}>
              <ErrorLine code={props.error} testId="organisation.create.error" />
              <Button type="submit" disabled={pending} data-testid="organisation.create.submit">
                {t('organisation.create.submit')}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function OrganisationHeader(props: {
  readonly current: OrganisationChoice
  readonly organisations: readonly OrganisationChoice[]
  readonly onSelect: (key: string) => void
}) {
  const t = useT()
  const { current } = props

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 data-testid="organisation.heading">{current.name}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground" data-testid="organisation.role">
          {t(current.role === 'admin' ? 'organisation.role.admin' : 'organisation.role.member')}
        </p>
        {props.organisations.length > 1 ? (
          <OptionSelect
            label={t('organisation.select')}
            value={current.key}
            options={props.organisations.map(({ key, name }) => ({ value: key, label: name }))}
            onChange={props.onSelect}
            testId="organisation.select"
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function NoteEntry(props: {
  readonly note: NoteItem
  readonly onEdit: OrganisationViewProps['onEditNote']
  readonly onDelete: OrganisationViewProps['onDeleteNote']
}) {
  const t = useT()
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [pending, run] = useAction()
  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    run(props.onEdit({ id: props.note.id, text: draft ?? '' }), (done) => {
      if (done) {
        setDraft(undefined)
      }
    })
  }

  return (
    <li className="flex flex-col gap-2" data-testid="organisation.notes.item">
      {draft === undefined ? (
        <div className="flex items-start justify-between gap-2">
          <p
            className="min-w-0 break-words whitespace-pre-wrap"
            data-testid="organisation.notes.text"
          >
            {props.note.text}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {props.note.mine ? (
              <span className="text-sm text-muted-foreground" data-testid="organisation.notes.mine">
                {t('organisation.notes.mine')}
              </span>
            ) : null}
            {props.note.editable ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft(props.note.text)}
                data-testid="organisation.notes.edit"
              >
                {t('organisation.notes.edit')}
              </Button>
            ) : null}
            {props.note.deletable ? (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => run(props.onDelete(props.note.id), () => {})}
                data-testid="organisation.notes.delete"
              >
                {t('organisation.notes.delete')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={save}>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={NOTE_TEXT_MAX}
            aria-label={t('organisation.notes.edit')}
            data-testid="organisation.notes.edit-input"
          />
          <Button type="submit" disabled={pending} data-testid="organisation.notes.save">
            {t('organisation.notes.save')}
          </Button>
        </form>
      )}
    </li>
  )
}

function NotesCard(props: {
  readonly notes: readonly NoteItem[] | undefined
  readonly error: string | undefined
  readonly onAdd: OrganisationViewProps['onAddNote']
  readonly onEdit: OrganisationViewProps['onEditNote']
  readonly onDelete: OrganisationViewProps['onDeleteNote']
}) {
  const t = useT()
  const [text, setText] = useState('')
  const [pending, run] = useAction()
  const add = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    run(props.onAdd(text), (done) => {
      if (done) {
        setText('')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.notes.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.notes && props.notes.length > 0 ? (
          <ul className="flex flex-col gap-4" data-testid="organisation.notes.list">
            {props.notes.map((note) => (
              <NoteEntry
                key={note.id}
                note={note}
                onEdit={props.onEdit}
                onDelete={props.onDelete}
              />
            ))}
          </ul>
        ) : null}
        {props.notes?.length === 0 ? (
          <p className="text-muted-foreground">{t('organisation.notes.empty')}</p>
        ) : null}
        <form onSubmit={add}>
          <Field data-invalid={props.error ? true : undefined}>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={NOTE_TEXT_MAX}
              placeholder={t('organisation.notes.placeholder')}
              aria-label={t('organisation.notes.placeholder')}
              aria-invalid={props.error ? true : undefined}
              data-testid="organisation.notes.input"
            />
            <ErrorLine code={props.error} testId="organisation.notes.error" />
            <Button type="submit" disabled={pending} data-testid="organisation.notes.add">
              {t('organisation.notes.add')}
            </Button>
          </Field>
        </form>
      </CardContent>
    </Card>
  )
}

function MembersCard(props: {
  readonly members: readonly MemberItem[] | undefined
  readonly error: string | undefined
  readonly onInvite: OrganisationViewProps['onInvite']
  readonly onRemove: OrganisationViewProps['onRemoveMember']
}) {
  const t = useT()
  const emailId = useId()
  const [email, setEmail] = useState('')
  const [pending, run] = useAction()
  const invite = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    run(props.onInvite(email), (done) => {
      if (done) {
        setEmail('')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.members.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.members ? (
          <ul className="flex flex-col gap-2" data-testid="organisation.members.list">
            {props.members.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-2"
                data-testid="organisation.members.item"
              >
                <span className="min-w-0 break-all">{member.email}</span>
                {member.removable ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => props.onRemove(member.id)}
                    data-testid="organisation.members.remove"
                  >
                    {t('organisation.members.remove')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={invite}>
          <Field data-invalid={props.error ? true : undefined}>
            <FieldLabel htmlFor={emailId}>{t('organisation.invite.email')}</FieldLabel>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              aria-invalid={props.error ? true : undefined}
              data-testid="organisation.invite.email"
            />
            <ErrorLine code={props.error} testId="organisation.invite.error" />
            <Button type="submit" disabled={pending} data-testid="organisation.invite.submit">
              {t('organisation.invite.submit')}
            </Button>
          </Field>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * The organisation page: without memberships, a way to create the first organisation; with
 * them, the current organisation's notes for every member, and its members for an administrator.
 */
export function OrganisationView(props: OrganisationViewProps) {
  const t = useT()
  const [creating, setCreating] = useState(false)
  const { current } = props

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      {current ? (
        <>
          <OrganisationHeader
            current={current}
            organisations={props.organisations}
            onSelect={props.onSelect}
          />
          {/* The forms' drafts belong to their organisation: another organisation starts afresh. */}
          <Fragment key={current.key}>
            <NotesCard
              notes={props.notes}
              error={props.errors?.notes}
              onAdd={props.onAddNote}
              onEdit={props.onEditNote}
              onDelete={props.onDeleteNote}
            />
            {current.role === 'admin' ? (
              <MembersCard
                members={props.members}
                error={props.errors?.members}
                onInvite={props.onInvite}
                onRemove={props.onRemoveMember}
              />
            ) : null}
          </Fragment>
          <Button
            type="button"
            variant="outline"
            aria-expanded={creating}
            onClick={() => setCreating(!creating)}
            data-testid="organisation.create.toggle"
          >
            {t('organisation.create.toggle')}
          </Button>
        </>
      ) : (
        <p className="text-muted-foreground" role="status" data-testid="organisation.none">
          {t('organisation.none')}
        </p>
      )}
      {current === undefined || creating ? (
        <CreateForm
          error={props.errors?.create}
          onCreate={props.onCreate}
          onCreated={() => setCreating(false)}
        />
      ) : null}
    </div>
  )
}
