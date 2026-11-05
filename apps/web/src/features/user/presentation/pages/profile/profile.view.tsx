import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'
import { Textarea } from '@workspace/ui/components/ui/textarea'

import type { ProfileFields } from '../../../application/profile.machine'
import { PROFILE_BIO_MAX } from '../../../domain/profile.entity'

export interface ProfileViewData {
  readonly name: string
  readonly email: string
  readonly bio?: string | undefined
}

/** The buttons the profile's flow handles: each is enabled while the machine's state does. */
export type ProfileControl = 'user.profile.save-button' | 'user.profile.sign-out-button'

export interface ProfileViewProps {
  readonly status: 'idle' | 'loading' | 'ready'
  /** The profile as stored: its heading and its email. */
  readonly profile: ProfileViewData | undefined
  /** What the fields show: the stored value, or what was typed while the field is edited. */
  readonly form: ProfileFields
  /** The code of the last refused save. */
  readonly error?: string | undefined
  /** Whether the flow's state handles a button's event: the button is enabled while it does. */
  readonly can: (control: ProfileControl) => boolean
  readonly onType: (field: keyof ProfileFields, value: string) => void
  /** Saves the form: resolves whether it saved, and the fields then hold no unsaved input. */
  readonly onSave: () => Promise<boolean>
  readonly onSignOut: () => void
  /**
   * Whether the flow's state renders the dialog that asks before signing out: this device holds
   * changes it could not send.
   */
  readonly confirmSignOut?: boolean
  readonly onConfirmSignOut: () => void
  readonly onCancelSignOut: () => void
}

/** The contract code of a refused change, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'profile:NAME_REQUIRED':
      return { code: 'name-required', text: t('user.profile.error.name-required') }
    case 'profile:NAME_TOO_LONG':
      return { code: 'name-too-long', text: t('user.profile.error.name-too-long') }
    case 'profile:BIO_TOO_LONG':
      return { code: 'bio-too-long', text: t('user.profile.error.bio-too-long') }
    default:
      return { code: 'failed', text: t('user.profile.error.failed') }
  }
}

/** The field each code of `user.profile.error` concerns, as the screen's `fields` say; others concern the form. */
const ERROR_FIELDS: Readonly<Record<string, keyof ProfileFields>> = {
  'name-required': 'name',
  'name-too-long': 'name',
  'bio-too-long': 'bio',
}

function ProfileForm(props: ProfileViewProps) {
  const t = useT()
  const nameId = useId()
  const bioId = useId()
  const error = props.error ? errorOf(t, props.error) : undefined
  const concerns = error ? ERROR_FIELDS[error.code] : undefined
  // One message: under the field its code concerns, or above Save when it concerns the form.
  const message = error ? (
    <FieldError data-testid="user.profile.error" data-code={error.code}>
      {error.text}
    </FieldError>
  ) : null

  return (
    <Form onSubmit={() => props.onSave()} data-testid="user.profile.form">
      <FieldGroup>
        <Field data-invalid={concerns === 'name' ? true : undefined}>
          <FieldLabel htmlFor={nameId}>{t('user.profile.name')}</FieldLabel>
          <Input
            id={nameId}
            value={props.form.name}
            onChange={(event) => props.onType('name', event.target.value)}
            autoComplete="name"
            aria-invalid={concerns === 'name' ? true : undefined}
            data-testid="user.profile.name-input"
          />
          {concerns === 'name' ? message : null}
        </Field>
        <Field data-invalid={concerns === 'bio' ? true : undefined}>
          <FieldLabel htmlFor={bioId}>{t('user.profile.bio')}</FieldLabel>
          <Textarea
            id={bioId}
            value={props.form.bio}
            onChange={(event) => props.onType('bio', event.target.value)}
            maxLength={PROFILE_BIO_MAX}
            aria-invalid={concerns === 'bio' ? true : undefined}
            data-testid="user.profile.bio-textarea"
          />
          {concerns === 'bio' ? message : null}
        </Field>
        <Field data-invalid={error && !concerns ? true : undefined}>
          {concerns ? null : message}
          <Button
            type="submit"
            disabled={!props.can('user.profile.save-button')}
            data-testid="user.profile.save-button"
          >
            {t('user.profile.save')}
          </Button>
        </Field>
      </FieldGroup>
    </Form>
  )
}

export function ProfileView(props: ProfileViewProps) {
  const t = useT()
  const emailId = useId()
  const { profile } = props

  if (!profile) {
    return (
      <p
        className="text-muted-foreground"
        role="status"
        data-testid="user.profile.status"
        data-state={props.status === 'ready' ? 'empty' : 'loading'}
      >
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
            <Input
              id={emailId}
              value={profile.email}
              readOnly
              data-testid="user.profile.email-input"
            />
          </Field>
          <ProfileForm {...props} />
          <Button
            type="button"
            variant="outline"
            disabled={!props.can('user.profile.sign-out-button')}
            onClick={() => props.onSignOut()}
            data-testid="user.profile.sign-out-button"
          >
            {t('user.profile.sign-out')}
          </Button>
        </FieldGroup>
        <ConfirmDialog
          open={props.confirmSignOut ?? false}
          title={t('user.profile.sign-out-offline.title')}
          description={t('user.profile.sign-out-offline.body')}
          confirmLabel={t('user.profile.sign-out-offline.confirm')}
          cancelLabel={t('user.profile.sign-out-offline.cancel')}
          destructive
          onConfirm={() => props.onConfirmSignOut()}
          onCancel={() => props.onCancelSignOut()}
          testId="user.profile.sign-out-dialog"
          code="unsent-changes"
        />
      </CardContent>
    </Card>
  )
}
