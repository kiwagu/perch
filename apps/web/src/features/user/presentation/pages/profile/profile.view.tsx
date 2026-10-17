import { type SubmitEvent, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/ui/alert-dialog'
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

function errorText(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'profile:NAME_REQUIRED':
      return t('user.profile.error.name-required')
    case 'profile:NAME_TOO_LONG':
      return t('user.profile.error.name-too-long')
    case 'profile:BIO_TOO_LONG':
      return t('user.profile.error.bio-too-long')
    default:
      return t('user.profile.error.failed')
  }
}

function SignOutConfirmation(props: {
  readonly open: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}) {
  const t = useT()

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('user.profile.sign-out-offline.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('user.profile.sign-out-offline.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="user.profile.sign-out-offline.cancel">
            {t('user.profile.sign-out-offline.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            onClick={props.onConfirm}
            data-testid="user.profile.sign-out-offline.confirm"
          >
            {t('user.profile.sign-out-offline.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
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
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    props.onSave({ name, bio })
  }

  return (
    <form onSubmit={submit}>
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
            data-testid="user.profile.bio-input"
          />
        </Field>
        <Field data-invalid={props.error ? true : undefined}>
          {props.error ? (
            <FieldError data-testid="user.profile.error">{errorText(t, props.error)}</FieldError>
          ) : null}
          <Button type="submit" disabled={props.saving} data-testid="user.profile.save">
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
            data-testid="user.profile.sign-out"
          >
            {t('user.profile.sign-out')}
          </Button>
        </FieldGroup>
        <SignOutConfirmation
          open={props.confirmSignOut ?? false}
          onConfirm={() => props.onSignOut({ forgetUnsent: true })}
          onCancel={() => props.onCancelSignOut?.()}
        />
      </CardContent>
    </Card>
  )
}
