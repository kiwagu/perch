import { type FormEvent, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Input } from '@workspace/ui/components/ui/input'

export interface ProfileViewData {
  readonly name: string
  readonly email: string
}

export interface ProfileViewProps {
  readonly status: 'idle' | 'loading' | 'ready'
  readonly profile: ProfileViewData | undefined
  readonly saving?: boolean
  /** The code of the last refused change. */
  readonly error?: string | undefined
  readonly onSaveName: (name: string) => void
  readonly onSignOut: () => void
}

function errorText(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'profile:NAME_REQUIRED':
      return t('user.profile.error.name-required')
    case 'profile:NAME_TOO_LONG':
      return t('user.profile.error.name-too-long')
    default:
      return t('user.profile.error.failed')
  }
}

function NameForm(props: {
  readonly name: string
  readonly saving: boolean
  readonly error: string | undefined
  readonly onSave: (name: string) => void
}) {
  const t = useT()
  const id = useId()
  const [draft, setDraft] = useState(props.name)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onSave(draft)
  }

  return (
    <form onSubmit={submit}>
      <Field data-invalid={props.error ? true : undefined}>
        <FieldLabel htmlFor={id}>{t('user.profile.name')}</FieldLabel>
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          autoComplete="name"
          aria-invalid={props.error ? true : undefined}
          data-testid="user.profile.name-input"
        />
        {props.error ? (
          <FieldError data-testid="user.profile.error">{errorText(t, props.error)}</FieldError>
        ) : null}
        <Button type="submit" disabled={props.saving} data-testid="user.profile.save">
          {t('user.profile.save')}
        </Button>
      </Field>
    </form>
  )
}

export function ProfileView(props: ProfileViewProps) {
  const t = useT()
  const emailId = useId()
  const { profile } = props

  if (!profile) {
    return (
      <p className="text-muted-foreground" role="status" data-testid="user.profile.status">
        {props.status === 'ready' ? t('user.profile.missing') : t('user.profile.loading')}
      </p>
    )
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h1 data-testid="user.profile.heading">{profile.name}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={emailId}>{t('user.profile.email')}</FieldLabel>
            <Input id={emailId} value={profile.email} readOnly data-testid="user.profile.email" />
          </Field>
          {/* A new stored name, saved here or elsewhere, restarts the draft from it. */}
          <NameForm
            key={profile.name}
            name={profile.name}
            saving={props.saving ?? false}
            error={props.error}
            onSave={props.onSaveName}
          />
          <Button
            type="button"
            variant="outline"
            onClick={props.onSignOut}
            data-testid="user.profile.sign-out"
          >
            {t('user.profile.sign-out')}
          </Button>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
