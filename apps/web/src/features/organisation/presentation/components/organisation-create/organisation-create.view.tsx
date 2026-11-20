import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import { concernsOf } from '../../../../../platform/concerns'
import type { OrganisationEvent } from '../../../application/organisation-machine'
import {
  type OrganisationErrorCode,
  organisationErrorOf,
} from '../organisation-error-line/organisation-error'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'

/** What the create form's fields hold: the organisation's key and its name. */
export interface CreateDraft {
  readonly key: string
  readonly name: string
}

/** The field each code of `organisation.create.error` concerns, as the screen's `fields` say. */
const ERROR_FIELDS: Partial<Record<OrganisationErrorCode, 'key' | 'name'>> = {
  'key-invalid': 'key',
  'key-taken': 'key',
  'name-required': 'name',
  'name-too-long': 'name',
}

/** The form that creates an organisation; the creator becomes its administrator. */
export function OrganisationCreate(props: {
  readonly draft: CreateDraft
  readonly error: string | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onChange: (draft: CreateDraft) => void
  readonly onCreate: (input: CreateDraft) => Promise<boolean>
}) {
  const t = useT()
  const keyId = useId()
  const nameId = useId()
  const hintId = useId()
  const { draft } = props
  const error = props.error ? organisationErrorOf(t, props.error) : undefined
  const concerns = concernsOf(ERROR_FIELDS, error?.code)
  // One message: under the field its code concerns, or above Submit when it concerns the form.
  const message = <OrganisationErrorLine code={props.error} testId="organisation.create.error" />

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.create.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={() => props.onCreate(draft)} data-testid="organisation.create.form">
          <FieldGroup>
            <Field data-invalid={concerns === 'key' ? true : undefined}>
              <FieldLabel htmlFor={keyId}>{t('organisation.create.key')}</FieldLabel>
              <Input
                id={keyId}
                value={draft.key}
                onChange={(event) => props.onChange({ ...draft, key: event.target.value })}
                autoCapitalize="none"
                autoComplete="off"
                maxLength={32}
                aria-invalid={concerns === 'key' ? true : undefined}
                aria-describedby={hintId}
                data-testid="organisation.create.key-input"
              />
              <FieldDescription id={hintId}>{t('organisation.create.key-hint')}</FieldDescription>
              {concerns === 'key' ? message : null}
            </Field>
            <Field data-invalid={concerns === 'name' ? true : undefined}>
              <FieldLabel htmlFor={nameId}>{t('organisation.create.name')}</FieldLabel>
              <Input
                id={nameId}
                value={draft.name}
                onChange={(event) => props.onChange({ ...draft, name: event.target.value })}
                autoComplete="organization"
                maxLength={80}
                aria-invalid={concerns === 'name' ? true : undefined}
                data-testid="organisation.create.name-input"
              />
              {concerns === 'name' ? message : null}
            </Field>
            <Field>
              {concerns === undefined ? message : null}
              <Button
                type="submit"
                disabled={!props.can({ type: 'organisation.create.submit-button', ...draft })}
                data-testid="organisation.create.submit-button"
              >
                {t('organisation.create.submit')}
              </Button>
            </Field>
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  )
}
