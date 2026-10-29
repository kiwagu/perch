import { useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import type { OrganisationEvent } from '../../../application/organisation.machine'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'

/** The form that creates an organisation; the creator becomes its administrator. */
export function OrganisationCreate(props: {
  readonly error: string | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onCreate: (input: { readonly key: string; readonly name: string }) => Promise<boolean>
}) {
  const t = useT()
  const keyId = useId()
  const nameId = useId()
  const hintId = useId()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const submit = () => {
    const created = props.onCreate({ key, name })

    void created.then((done) => {
      if (done) {
        setKey('')
        setName('')
      }
    })

    return created
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.create.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={submit} data-testid="organisation.create.form">
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
                data-testid="organisation.create.key-input"
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
                data-testid="organisation.create.name-input"
              />
            </Field>
            <Field data-invalid={props.error ? true : undefined}>
              <OrganisationErrorLine code={props.error} testId="organisation.create.error" />
              <Button
                type="submit"
                disabled={!props.can({ type: 'organisation.create.submit-button', key, name })}
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
