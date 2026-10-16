import { type FormEvent, useId, useState } from 'react'

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
  readonly onSubmit: (values: SignInValues) => void
  readonly onToggleMode: () => void
}

function errorText(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return t('user.sign-in.error.invalid-credentials')
    case 'data:SIGN_UP_REJECTED':
      return t('user.sign-in.error.sign-up-rejected')
    case 'profile:NAME_REQUIRED':
      return t('user.sign-in.error.name-required')
    case 'profile:NAME_TOO_LONG':
      return t('user.sign-in.error.name-too-long')
    default:
      return t('user.sign-in.error.failed')
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
  const submit = (event: FormEvent) => {
    event.preventDefault()
    props.onSubmit(values)
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            {props.error ? (
              <Alert variant="destructive">
                <AlertDescription data-testid="user.sign-in.error">
                  {errorText(t, props.error)}
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
                data-testid="user.sign-in.email"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.password}>{t('user.sign-in.password')}</FieldLabel>
              <Input
                {...field('password')}
                type="password"
                autoComplete={signingUp ? 'new-password' : 'current-password'}
                required
                data-testid="user.sign-in.password"
              />
            </Field>
            {signingUp ? (
              <Field>
                <FieldLabel htmlFor={ids.name}>{t('user.sign-in.name')}</FieldLabel>
                <Input
                  {...field('name')}
                  autoComplete="name"
                  required
                  data-testid="user.sign-in.name"
                />
              </Field>
            ) : null}
            <Button type="submit" disabled={props.submitting} data-testid="user.sign-in.submit">
              {signingUp ? t('user.sign-in.sign-up') : t('user.sign-in.sign-in')}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={props.onToggleMode}
              data-testid="user.sign-in.toggle"
            >
              {signingUp ? t('user.sign-in.have-account') : t('user.sign-in.create-account')}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
