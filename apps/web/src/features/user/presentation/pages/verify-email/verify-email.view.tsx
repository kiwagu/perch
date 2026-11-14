import { type ComponentType, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import { type PageLinkProps, PlainLink } from '../../components/page-link/page-link'

/** The anchors only some states of the flow render that the page shows or leaves out. */
export type VerifyEmailListed =
  | 'user.verify-email.status'
  | 'user.verify-email.sign-in-link'
  | 'user.verify-email.form'

export interface VerifyEmailViewProps {
  /**
   * Whether the flow's state renders an anchor: the status while the link is checked, the way to
   * sign in once it was verified before, the form that sends a new link once one is offered.
   */
  readonly renders: (anchor: VerifyEmailListed) => boolean
  /** The code the message shows: the link was verified before, or a new one is on its way. */
  readonly message?: 'verified-before' | 'check-your-mail' | undefined
  /** The address the new link went to, which `check-your-mail` names. */
  readonly sentTo?: string | undefined
  /** The code of the failure the error shows: of the link, or of the last resend. */
  readonly error?: string | undefined
  /** Whether its button can send now. */
  readonly canResend: boolean
  /** Sends a new link to `email`: resolves whether it did. */
  readonly onResend: (email: string) => Promise<boolean>
  readonly link?: ComponentType<PageLinkProps>
}

/** The contract code of a failure, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'data:LINK_INVALID':
      return { code: 'link-invalid', text: t('user.verify-email.error.link-invalid') }
    case 'data:LINK_EXPIRED':
      return { code: 'link-expired', text: t('user.verify-email.error.link-expired') }
    case 'data:ACCOUNT_BANNED':
      return { code: 'account-banned', text: t('user.verify-email.error.account-banned') }
    case 'data:OTHER_ACCOUNT':
      return { code: 'other-account', text: t('user.verify-email.error.other-account') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.verify-email.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.verify-email.error.failed') }
  }
}

/** What the link of a verification mail opens: its check, what it did, or a new link sent. */
export function VerifyEmailView(props: VerifyEmailViewProps) {
  const t = useT()
  const emailId = useId()
  const [email, setEmail] = useState('')
  const Link = props.link ?? PlainLink
  const error = props.error ? errorOf(t, props.error) : undefined

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{t('user.verify-email.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {props.renders('user.verify-email.status') ? (
            <p role="status" data-testid="user.verify-email.status" data-state="loading">
              {t('user.verify-email.checking')}
            </p>
          ) : null}
          {props.message ? (
            <Alert>
              <AlertDescription data-testid="user.verify-email.message" data-code={props.message}>
                {props.message === 'verified-before'
                  ? t('user.verify-email.message.verified-before')
                  : t('user.verify-email.message.check-your-mail', { email: props.sentTo ?? '' })}
              </AlertDescription>
            </Alert>
          ) : null}
          {props.renders('user.verify-email.sign-in-link') ? (
            <Link to="/sign-in" className="underline" data-testid="user.verify-email.sign-in-link">
              {t('user.verify-email.sign-in')}
            </Link>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="user.verify-email.error" data-code={error.code}>
                {error.text}
              </AlertDescription>
            </Alert>
          ) : null}
          {props.renders('user.verify-email.form') ? (
            <Form onSubmit={() => props.onResend(email)} data-testid="user.verify-email.form">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={emailId}>{t('user.verify-email.email')}</FieldLabel>
                  <Input
                    id={emailId}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    required
                    data-testid="user.verify-email.email-input"
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={!props.canResend}
                  data-testid="user.verify-email.resend-button"
                >
                  {t('user.verify-email.resend')}
                </Button>
              </FieldGroup>
            </Form>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
