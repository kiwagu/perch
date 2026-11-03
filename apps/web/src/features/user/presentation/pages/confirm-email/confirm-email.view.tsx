import type { ComponentType } from 'react'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { FieldGroup } from '@workspace/ui/components/ui/field'

import { type PageLinkProps, PlainLink } from '../../components/page-link/page-link'

/** Where the page leads once the email changed: by who is signed in here, or nowhere. */
export type ConfirmEmailOnward = 'profile' | 'sign-in' | 'none'

export interface ConfirmEmailViewProps {
  /** Whether the link is being checked. */
  readonly confirming: boolean
  /** The code the message shows once the email is the new one. */
  readonly message?: 'email-changed' | undefined
  /** Where the page leads with the message. */
  readonly onward: ConfirmEmailOnward
  /** The code of the failure the error shows. */
  readonly error?: string | undefined
  readonly link?: ComponentType<PageLinkProps>
}

/** The contract code of a failure, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'data:LINK_INVALID':
      return { code: 'link-invalid', text: t('user.confirm-email.error.link-invalid') }
    case 'data:LINK_EXPIRED':
      return { code: 'link-expired', text: t('user.confirm-email.error.link-expired') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.confirm-email.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.confirm-email.error.failed') }
  }
}

/** What the link of an email confirmation opens: its check, then what it did. */
export function ConfirmEmailView(props: ConfirmEmailViewProps) {
  const t = useT()
  const Link = props.link ?? PlainLink
  const error = props.error ? errorOf(t, props.error) : undefined

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{t('user.confirm-email.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {props.confirming ? (
            <p role="status" data-testid="user.confirm-email.status" data-state="loading">
              {t('user.confirm-email.checking')}
            </p>
          ) : null}
          {props.message ? (
            <Alert variant="success">
              <AlertDescription data-testid="user.confirm-email.message" data-code={props.message}>
                {t('user.confirm-email.message.email-changed')}
              </AlertDescription>
            </Alert>
          ) : null}
          {props.message && props.onward === 'profile' ? (
            <Link
              to="/me"
              className="text-sm underline"
              data-testid="user.confirm-email.profile-link"
            >
              {t('user.confirm-email.profile')}
            </Link>
          ) : null}
          {props.message && props.onward === 'sign-in' ? (
            <Link
              to="/sign-in"
              className="text-sm underline"
              data-testid="user.confirm-email.sign-in-link"
            >
              {t('user.confirm-email.sign-in')}
            </Link>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="user.confirm-email.error" data-code={error.code}>
                {error.text}
              </AlertDescription>
            </Alert>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
