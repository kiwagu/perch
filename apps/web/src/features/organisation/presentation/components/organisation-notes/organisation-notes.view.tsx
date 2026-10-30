import { useState } from 'react'

import { useT } from '@workspace/i18n'
import type { NoteId } from '@workspace/ids'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Textarea } from '@workspace/ui/components/ui/textarea'

import type { OrganisationEvent } from '../../../application/organisation.machine'
import { NOTE_TEXT_MAX } from '../../../domain/note.entity'
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

/** What a note's own controls do, and whether the page's flow takes each now. */
interface NoteActions {
  readonly can: (event: OrganisationEvent) => boolean
  readonly onOpenEdit: (id: NoteId) => void
  /** Resolves true once saved. */
  readonly onEdit: (input: { readonly id: NoteId; readonly text: string }) => Promise<boolean>
  readonly onDelete: (id: NoteId) => void
}

/** The edit form of a note: it starts from the note's text, and what was typed goes with it. */
function NoteEditForm(props: {
  readonly note: NoteItem
  readonly can: NoteActions['can']
  readonly onEdit: NoteActions['onEdit']
}) {
  const t = useT()
  const [draft, setDraft] = useState(props.note.text)
  const save: OrganisationEvent = {
    type: 'organisation.notes.save-button',
    id: props.note.id,
    text: draft,
  }

  return (
    <Form
      className="flex flex-col gap-2"
      onSubmit={() => props.onEdit({ id: props.note.id, text: draft })}
    >
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={NOTE_TEXT_MAX}
        aria-label={t('organisation.notes.edit')}
        data-testid="organisation.notes.edit-textarea"
      />
      <Button
        type="submit"
        disabled={!props.can(save)}
        data-testid="organisation.notes.save-button"
      >
        {t('organisation.notes.save')}
      </Button>
    </Form>
  )
}

function NoteEntry(props: NoteActions & { readonly note: NoteItem; readonly editing: boolean }) {
  const t = useT()
  const { note } = props

  return (
    <li className="flex flex-col gap-2" data-testid="organisation.notes.item" data-id={note.id}>
      {props.editing ? (
        <NoteEditForm note={note} can={props.can} onEdit={props.onEdit} />
      ) : (
        <div className="flex items-start justify-between gap-2">
          <p
            className="min-w-0 break-words whitespace-pre-wrap"
            data-testid="organisation.notes.text-cell"
          >
            {note.text}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {note.mine ? (
              <span
                className="text-sm text-muted-foreground"
                data-testid="organisation.notes.mine-badge"
              >
                {t('organisation.notes.mine')}
              </span>
            ) : null}
            {note.editable ? (
              <Button
                type="button"
                variant="outline"
                disabled={!props.can({ type: 'organisation.notes.edit-button', id: note.id })}
                onClick={() => props.onOpenEdit(note.id)}
                data-testid="organisation.notes.edit-button"
              >
                {t('organisation.notes.edit')}
              </Button>
            ) : null}
            {note.deletable ? (
              <Button
                type="button"
                variant="outline"
                disabled={!props.can({ type: 'organisation.notes.delete-button', id: note.id })}
                onClick={() => props.onDelete(note.id)}
                data-testid="organisation.notes.delete-button"
              >
                {t('organisation.notes.delete')}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * The notes card: the current organisation's notes, oldest first, one of them in its edit form
 * while it is edited, and the new note form.
 */
export function OrganisationNotes(
  props: NoteActions & {
    readonly notes: readonly NoteItem[] | undefined
    /** The note whose edit form is shown; none while no note is edited. */
    readonly editing: NoteId | undefined
    readonly error: string | undefined
    /** Resolves true once the note is written. */
    readonly onAdd: (text: string) => Promise<boolean>
  },
) {
  const t = useT()
  const [text, setText] = useState('')
  const state = props.notes === undefined ? 'loading' : props.notes.length > 0 ? 'ready' : 'empty'
  const add = () => {
    const added = props.onAdd(text)

    void added.then((done) => {
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
                editing={props.editing === note.id}
                can={props.can}
                onOpenEdit={props.onOpenEdit}
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
            <Button
              type="submit"
              disabled={!props.can({ type: 'organisation.notes.add-button', text })}
              data-testid="organisation.notes.add-button"
            >
              {t('organisation.notes.add')}
            </Button>
          </Field>
        </Form>
      </CardContent>
    </Card>
  )
}
