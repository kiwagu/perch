import { useState } from 'react'

import { useT } from '@workspace/i18n'
import type { NoteId } from '@workspace/ids'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Textarea } from '@workspace/ui/components/ui/textarea'

import { NOTE_TEXT_MAX } from '../../../domain/note.entity'
import { useAction } from '../../pages/organisation/use-action'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'

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

/** What a note's own buttons do; each resolves true once done. */
interface NoteActions {
  readonly onEdit: (input: { readonly id: NoteId; readonly text: string }) => Promise<boolean>
  readonly onDelete: (id: NoteId) => Promise<boolean>
}

function NoteEntry(props: {
  readonly note: NoteItem
  readonly onEdit: NoteActions['onEdit']
  readonly onDelete: NoteActions['onDelete']
}) {
  const t = useT()
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [pending, run] = useAction()
  const save = () => {
    const edited = props.onEdit({ id: props.note.id, text: draft ?? '' })

    run(edited, (done) => {
      if (done) {
        setDraft(undefined)
      }
    })

    return edited
  }

  return (
    <li
      className="flex flex-col gap-2"
      data-testid="organisation.notes.item"
      data-id={props.note.id}
    >
      {draft === undefined ? (
        <div className="flex items-start justify-between gap-2">
          <p
            className="min-w-0 break-words whitespace-pre-wrap"
            data-testid="organisation.notes.text-cell"
          >
            {props.note.text}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {props.note.mine ? (
              <span
                className="text-sm text-muted-foreground"
                data-testid="organisation.notes.mine-badge"
              >
                {t('organisation.notes.mine')}
              </span>
            ) : null}
            {props.note.editable ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDraft(props.note.text)}
                data-testid="organisation.notes.edit-button"
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
                data-testid="organisation.notes.delete-button"
              >
                {t('organisation.notes.delete')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Form className="flex flex-col gap-2" onSubmit={save}>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={NOTE_TEXT_MAX}
            aria-label={t('organisation.notes.edit')}
            data-testid="organisation.notes.edit-textarea"
          />
          <Button type="submit" disabled={pending} data-testid="organisation.notes.save-button">
            {t('organisation.notes.save')}
          </Button>
        </Form>
      )}
    </li>
  )
}

/** The notes card: the current organisation's notes, oldest first, and the new note form. */
export function OrganisationNotes(props: {
  readonly notes: readonly NoteItem[] | undefined
  readonly error: string | undefined
  readonly onAdd: (text: string) => Promise<boolean>
  readonly onEdit: NoteActions['onEdit']
  readonly onDelete: NoteActions['onDelete']
}) {
  const t = useT()
  const [text, setText] = useState('')
  const [pending, run] = useAction()
  const state = props.notes === undefined ? 'loading' : props.notes.length > 0 ? 'ready' : 'empty'
  const add = () => {
    const added = props.onAdd(text)

    run(added, (done) => {
      if (done) {
        setText('')
      }
    })

    return added
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.notes.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent
        className="flex flex-col gap-4"
        data-testid="organisation.notes.section"
        data-state={state}
      >
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
          <p
            className="text-muted-foreground"
            data-testid="organisation.notes.empty-message"
            data-code="no-notes"
          >
            {t('organisation.notes.empty')}
          </p>
        ) : null}
        <Form onSubmit={add}>
          <Field data-invalid={props.error ? true : undefined}>
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={NOTE_TEXT_MAX}
              placeholder={t('organisation.notes.placeholder')}
              aria-label={t('organisation.notes.placeholder')}
              aria-invalid={props.error ? true : undefined}
              data-testid="organisation.notes.new-textarea"
            />
            <OrganisationErrorLine code={props.error} testId="organisation.notes.error" />
            <Button type="submit" disabled={pending} data-testid="organisation.notes.add-button">
              {t('organisation.notes.add')}
            </Button>
          </Field>
        </Form>
      </CardContent>
    </Card>
  )
}
