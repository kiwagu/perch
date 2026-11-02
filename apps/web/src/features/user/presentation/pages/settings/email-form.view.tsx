import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

/** The anchor of the form's error, drawn above the form or under the field its code concerns. */
const EMAIL_ERROR_TEST_ID = 'user.settings.email.error'

/** What the form holds: the new email, and the current password that confirms the request. */
export interface EmailFormValues {
  readonly email: string
  readonly password: string
}

export interface EmailFormViewProps {
  readonly values: EmailFormValues
  /** The code of the last failure. */
  readonly error?: string | undefined
  /** The code of the message, once the mail to the new email went out. */
  readonly message?: 'check-your-mail' | undefined
  /** The new email that mail went to, which the message names. */
  readonly sentTo?: string | undefined
  /** Whether the flow takes the send now: the button is enabled while it does. */
  readonly canSend: boolean
  readonly onChange: (values: EmailFormValues) => void
  /** Sends the mail that confirms the new email: resolves whether it went out. */
  readonly onSend: () => Promise<boolean>
}

/** The contract code of a failure, the field it concerns if any, and its text. */
function errorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: string; field?: keyof EmailFormValues; text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return {
        code: 'invalid-credentials',
        field: 'password',
        text: t('user.settings.email.error.invalid-credentials'),
      }
    case 'data:EMAIL_INVALID':
      return {
        code: 'email-invalid',
        field: 'email',
        text: t('user.settings.email.error.email-invalid'),
      }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.settings.email.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.settings.email.error.failed') }
  }
}

/** The account's email, changed once the link of the mail sent to the new one is opened. */
export function EmailFormView(props: EmailFormViewProps) {
  const t = useT()
  const ids = { email: useId(), password: useId(), error: useId() }
  const error = props.error ? errorOf(t, props.error) : undefined
  const marked = (name: keyof EmailFormValues) => ({
    'aria-invalid': error?.field === name ? true : undefined,
    'aria-describedby': error?.field === name ? ids.error : undefined,
  })
  const underField = (name: keyof EmailFormValues) =>
    error?.field === name ? (
      <FieldError id={ids.error} data-testid={EMAIL_ERROR_TEST_ID} data-code={error.code}>
        {error.text}
      </FieldError>
    ) : null

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h2>{t('user.settings.email.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={props.onSend} data-testid="user.settings.email.form">
          <FieldGroup>
            {props.message ? (
              <Alert>
                <AlertDescription
                  data-testid="user.settings.email.message"
                  data-code={props.message}
                >
                  {t('user.settings.email.message.check-your-mail', { email: props.sentTo ?? '' })}
                </AlertDescription>
              </Alert>
            ) : null}
            {error && error.field === undefined ? (
              <Alert variant="destructive">
                <AlertDescription data-testid={EMAIL_ERROR_TEST_ID} data-code={error.code}>
                  {error.text}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={error?.field === 'email' ? true : undefined}>
              <FieldLabel htmlFor={ids.email}>{t('user.settings.email.email')}</FieldLabel>
              <Input
                id={ids.email}
                value={props.values.email}
                onChange={(event) => props.onChange({ ...props.values, email: event.target.value })}
                type="email"
                autoComplete="email"
                required
                {...marked('email')}
                data-testid="user.settings.email.email-input"
              />
              {underField('email')}
            </Field>
            <Field data-invalid={error?.field === 'password' ? true : undefined}>
              <FieldLabel htmlFor={ids.password}>{t('user.settings.email.password')}</FieldLabel>
              <PasswordInput
                id={ids.password}
                value={props.values.password}
                onChange={(event) =>
                  props.onChange({ ...props.values, password: event.target.value })
                }
                autoComplete="current-password"
                required
                {...marked('password')}
                showLabel={t('user.password.show')}
                hideLabel={t('user.password.hide')}
                testId="user.settings.email.password-input"
              />
              {underField('password')}
            </Field>
            <Button
              type="submit"
              disabled={!props.canSend}
              data-testid="user.settings.email.send-button"
            >
              {t('user.settings.email.send')}
            </Button>
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  )
}
