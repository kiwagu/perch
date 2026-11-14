import { type ComponentType, useId } from 'react'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import { type PageLinkProps, PlainLink } from '../../components/page-link/page-link'

export interface ForgotPasswordViewProps {
  /** What the email field holds: at first the one the sign-in page carried over, or none. */
  readonly email: string
  /** The email field as typed. */
  readonly onEmailChange: (email: string) => void
  /** The code the message shows once the mail was asked for. */
  readonly message?: 'check-your-mail' | undefined
  /** The address the mail was asked for, which the message names. */
  readonly sentTo?: string | undefined
  /** The code of the last failure. */
  readonly error?: string | undefined
  /** Whether the flow takes the send button now: it is enabled while it does. */
  readonly canSend: boolean
  /** Asks for the mail for `email`: resolves whether it went through. */
  readonly onSend: (email: string) => Promise<boolean>
  readonly link?: ComponentType<PageLinkProps>
}

/** The contract code of a failure, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  return code === 'data:RATE_LIMITED'
    ? { code: 'rate-limited', text: t('user.forgot-password.error.rate-limited') }
    : { code: 'failed', text: t('user.forgot-password.error.failed') }
}

/** Where a visitor who forgot the password asks for the mail that sets a new one. */
export function ForgotPasswordView(props: ForgotPasswordViewProps) {
  const t = useT()
  const emailId = useId()
  const Link = props.link ?? PlainLink
  const error = props.error ? errorOf(t, props.error) : undefined

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{t('user.forgot-password.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form
          onSubmit={() => props.onSend(props.email)}
          marksState={false}
          data-testid="user.forgot-password.form"
        >
          <FieldGroup>
            <p className="text-sm text-muted-foreground">{t('user.forgot-password.hint')}</p>
            {props.message ? (
              <Alert>
                <AlertDescription
                  data-testid="user.forgot-password.message"
                  data-code={props.message}
                >
                  {t('user.forgot-password.message.check-your-mail', {
                    email: props.sentTo ?? '',
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription data-testid="user.forgot-password.error" data-code={error.code}>
                  {error.text}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor={emailId}>{t('user.forgot-password.email')}</FieldLabel>
              <Input
                id={emailId}
                value={props.email}
                onChange={(event) => props.onEmailChange(event.target.value)}
                type="email"
                autoComplete="email"
                required
                data-testid="user.forgot-password.email-input"
              />
            </Field>
            <Button
              type="submit"
              disabled={!props.canSend}
              data-testid="user.forgot-password.send-button"
            >
              {t('user.forgot-password.send')}
            </Button>
            <Link
              to="/sign-in"
              className="text-sm underline"
              data-testid="user.forgot-password.sign-in-link"
            >
              {t('user.forgot-password.sign-in')}
            </Link>
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  )
}
