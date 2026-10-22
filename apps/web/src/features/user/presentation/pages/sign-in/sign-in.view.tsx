import { type SubmitEvent, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Input } from '@workspace/ui/components/ui/input'

export interface SignInValues {
  readonly email: string
  readonly password: string
  readonly name: string
}

export interface SignInViewProps {
  readonly mode: 'sign-in' | 'sign-up'
  readonly submitting: boolean
  /** The code of the last failure. */
  readonly error?: string | undefined
  /**
   * Why the last session ended, when the person should know: `resend-after-sign-in` once the
   * device was signed out while it held changes it had not sent, `signed-out-elsewhere` once
   * another device signed it out.
   */
  readonly notice?: 'resend-after-sign-in' | 'signed-out-elsewhere' | 'delete-pending' | undefined
  readonly onSubmit: (values: SignInValues) => void
  readonly onToggleMode: () => void
}

/** The contract code of a refusal, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return { code: 'invalid-credentials', text: t('user.sign-in.error.invalid-credentials') }
    case 'data:SIGN_UP_REJECTED':
      return { code: 'sign-up-rejected', text: t('user.sign-in.error.sign-up-rejected') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.sign-in.error.rate-limited') }
    case 'data:OTHER_ACCOUNT':
      return { code: 'other-account', text: t('user.sign-in.error.other-account') }
    case 'profile:NAME_REQUIRED':
      return { code: 'name-required', text: t('user.sign-in.error.name-required') }
    case 'profile:NAME_TOO_LONG':
      return { code: 'name-too-long', text: t('user.sign-in.error.name-too-long') }
    default:
      return { code: 'failed', text: t('user.sign-in.error.failed') }
  }
}

/** The text of the notice the last session left. */
function noticeText(
  t: ReturnType<typeof useT>,
  notice: NonNullable<SignInViewProps['notice']>,
): string {
  switch (notice) {
    case 'resend-after-sign-in':
      return t('user.sign-in.notice.resend-after-sign-in')
    case 'signed-out-elsewhere':
      return t('user.sign-in.notice.signed-out-elsewhere')
    case 'delete-pending':
      return t('user.sign-in.notice.delete-pending')
  }
}

export function SignInView(props: SignInViewProps) {
  const t = useT()
  const ids = { email: useId(), password: useId(), name: useId() }
  const [values, setValues] = useState<SignInValues>({ email: '', password: '', name: '' })
  const signingUp = props.mode === 'sign-up'
  const title = signingUp ? t('user.sign-in.create-account') : t('user.sign-in.sign-in')
  const field = (name: keyof SignInValues) => ({
    id: ids[name],
    value: values[name],
    onChange: (event: { readonly target: { readonly value: string } }) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  })
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    props.onSubmit(values)
  }
  const error = props.error ? errorOf(t, props.error) : undefined

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} data-testid="user.sign-in.form">
          <FieldGroup>
            {props.notice ? (
              <Alert>
                <AlertDescription
                  data-testid="user.sign-in.notice-message"
                  data-code={props.notice}
                >
                  {noticeText(t, props.notice)}
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription data-testid="user.sign-in.error" data-code={error.code}>
                  {error.text}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor={ids.email}>{t('user.sign-in.email')}</FieldLabel>
              <Input
                {...field('email')}
                type="email"
                autoComplete="email"
                required
                data-testid="user.sign-in.email-input"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.password}>{t('user.sign-in.password')}</FieldLabel>
              <Input
                {...field('password')}
                type="password"
                autoComplete={signingUp ? 'new-password' : 'current-password'}
                required
                data-testid="user.sign-in.password-input"
              />
            </Field>
            {signingUp ? (
              <Field>
                <FieldLabel htmlFor={ids.name}>{t('user.sign-in.name')}</FieldLabel>
                <Input
                  {...field('name')}
                  autoComplete="name"
                  required
                  data-testid="user.sign-in.name-input"
                />
              </Field>
            ) : null}
            <Button
              type="submit"
              disabled={props.submitting}
              data-testid="user.sign-in.submit-button"
            >
              {signingUp ? t('user.sign-in.sign-up') : t('user.sign-in.sign-in')}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={props.onToggleMode}
              data-testid="user.sign-in.toggle-button"
              data-value={signingUp ? 'sign-in' : 'sign-up'}
            >
              {signingUp ? t('user.sign-in.have-account') : t('user.sign-in.create-account')}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
