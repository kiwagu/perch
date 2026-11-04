import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'

/** The anchor of the form's error, drawn above the form or under the field its code concerns. */
const DELETION_ERROR_TEST_ID = 'user.settings.deletion.error'

export interface DeletionFormViewProps {
  /** The password typed, which the page holds: the mail going out empties it. */
  readonly password: string
  /** The code of the last failure. */
  readonly error?: string | undefined
  /** The code of the message, once the mail with the deletion link went out. */
  readonly message?: 'check-your-mail' | undefined
  /** Whether the flow takes the send now: the button is enabled while it does. */
  readonly canSend: boolean
  readonly onChange: (password: string) => void
  /** Sends the mail with the deletion link: resolves whether it went out. */
  readonly onSend: () => Promise<boolean>
}

/** The contract code of a failure, whether it concerns the password field, and its text. */
function errorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: string; underPassword?: true; text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return {
        code: 'invalid-credentials',
        underPassword: true,
        text: t('user.settings.deletion.error.invalid-credentials'),
      }
    case 'data:LAST_ADMIN':
      return { code: 'last-admin', text: t('user.settings.deletion.error.last-admin') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.settings.deletion.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.settings.deletion.error.failed') }
  }
}

/**
 * The account's deletion, asked for with its password: the mail that goes out carries a link,
 * and only the page it opens deletes the account, for good.
 */
export function DeletionFormView(props: DeletionFormViewProps) {
  const t = useT()
  const ids = { password: useId(), error: useId() }
  const error = props.error ? errorOf(t, props.error) : undefined
  const underPassword = error?.underPassword === true

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h2>{t('user.settings.deletion.title')}</h2>
        </CardTitle>
        <CardDescription>{t('user.settings.deletion.warning')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={props.onSend} data-testid="user.settings.deletion.form">
          <FieldGroup>
            {props.message ? (
              <Alert>
                <AlertDescription
                  data-testid="user.settings.deletion.message"
                  data-code={props.message}
                >
                  {t('user.settings.deletion.message.check-your-mail')}
                </AlertDescription>
              </Alert>
            ) : null}
            {error && !underPassword ? (
              <Alert variant="destructive">
                <AlertDescription data-testid={DELETION_ERROR_TEST_ID} data-code={error.code}>
                  {error.text}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={underPassword ? true : undefined}>
              <FieldLabel htmlFor={ids.password}>{t('user.settings.deletion.password')}</FieldLabel>
              <PasswordInput
                id={ids.password}
                value={props.password}
                onChange={(event) => props.onChange(event.target.value)}
                autoComplete="current-password"
                required
                aria-invalid={underPassword ? true : undefined}
                aria-describedby={underPassword ? ids.error : undefined}
                showLabel={t('user.password.show')}
                hideLabel={t('user.password.hide')}
                testId="user.settings.deletion.password-input"
              />
              {error && underPassword ? (
                <FieldError
                  id={ids.error}
                  data-testid={DELETION_ERROR_TEST_ID}
                  data-code={error.code}
                >
                  {error.text}
                </FieldError>
              ) : null}
            </Field>
            <Button
              type="submit"
              variant="destructive"
              disabled={!props.canSend}
              data-testid="user.settings.deletion.send-button"
            >
              {t('user.settings.deletion.send')}
            </Button>
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  )
}
