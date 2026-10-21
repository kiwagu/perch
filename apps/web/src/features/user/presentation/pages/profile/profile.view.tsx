import { type SubmitEvent, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Input } from '@workspace/ui/components/ui/input'
import { Textarea } from '@workspace/ui/components/ui/textarea'

import { PROFILE_BIO_MAX } from '../../../domain/profile.entity'

export interface ProfileViewData {
  readonly name: string
  readonly email: string
  readonly bio?: string | undefined
}

/** What the person typed into the profile form, saved together by one Save. */
export interface ProfileDraft {
  readonly name: string
  readonly bio: string
}

export interface ProfileViewProps {
  readonly status: 'idle' | 'loading' | 'ready'
  readonly profile: ProfileViewData | undefined
  readonly saving?: boolean
  /** The code of the last refused change. */
  readonly error?: string | undefined
  readonly onSave: (draft: ProfileDraft) => void
  /** Signs out; `forgetUnsent` once the person confirmed losing changes this device could not send. */
  readonly onSignOut: (options?: { readonly forgetUnsent: true }) => void
  /** Signing out would lose changes this device could not send: the person confirms or cancels. */
  readonly confirmSignOut?: boolean
  readonly onCancelSignOut?: () => void
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

/**
 * A draft of a stored value. It starts from the stored value and restarts from it whenever
 * the stored value changes, saved here or on another device.
 */
function useDraft(stored: string): readonly [string, (value: string) => void] {
  const [draft, setDraft] = useState({ from: stored, value: stored })

  // Adjusting state while rendering: React renders again at once, before anything is shown.
  if (draft.from !== stored) {
    setDraft({ from: stored, value: stored })
  }

  return [
    draft.from === stored ? draft.value : stored,
    (value) => setDraft({ from: stored, value }),
  ]
}

const NAME_CODES: ReadonlySet<string> = new Set(['profile:NAME_REQUIRED', 'profile:NAME_TOO_LONG'])

function ProfileForm(props: {
  readonly name: string
  readonly bio: string
  readonly saving: boolean
  readonly error: string | undefined
  readonly onSave: (draft: ProfileDraft) => void
}) {
  const t = useT()
  const nameId = useId()
  const bioId = useId()
  const [name, setName] = useDraft(props.name)
  const [bio, setBio] = useDraft(props.bio)
  const nameRefused = props.error !== undefined && NAME_CODES.has(props.error)
  const bioRefused = props.error === 'profile:BIO_TOO_LONG'
  const error = props.error ? errorOf(t, props.error) : undefined
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    props.onSave({ name, bio })
  }

  return (
    <form onSubmit={submit} data-testid="user.profile.form">
      <FieldGroup>
        <Field data-invalid={nameRefused ? true : undefined}>
          <FieldLabel htmlFor={nameId}>{t('user.profile.name')}</FieldLabel>
          <Input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            aria-invalid={nameRefused ? true : undefined}
            data-testid="user.profile.name-input"
          />
        </Field>
        <Field data-invalid={bioRefused ? true : undefined}>
          <FieldLabel htmlFor={bioId}>{t('user.profile.bio')}</FieldLabel>
          <Textarea
            id={bioId}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={PROFILE_BIO_MAX}
            aria-invalid={bioRefused ? true : undefined}
            data-testid="user.profile.bio-textarea"
          />
        </Field>
        <Field data-invalid={error ? true : undefined}>
          {error ? (
            <FieldError data-testid="user.profile.error" data-code={error.code}>
              {error.text}
            </FieldError>
          ) : null}
          <Button type="submit" disabled={props.saving} data-testid="user.profile.save-button">
            {t('user.profile.save')}
          </Button>
        </Field>
      </FieldGroup>
    </form>
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
          <ProfileForm
            name={profile.name}
            bio={profile.bio ?? ''}
            saving={props.saving ?? false}
            error={props.error}
            onSave={props.onSave}
          />
          <Button
            type="button"
            variant="outline"
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
          onConfirm={() => props.onSignOut({ forgetUnsent: true })}
          onCancel={() => props.onCancelSignOut?.()}
          testId="user.profile.sign-out-dialog"
          code="unsent-changes"
        />
      </CardContent>
    </Card>
  )
}
