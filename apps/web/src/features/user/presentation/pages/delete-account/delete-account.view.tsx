import type { ComponentType } from 'react'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { FieldGroup } from '@workspace/ui/components/ui/field'

import { type PageLinkProps, PlainLink } from '../../components/page-link/page-link'

export interface DeleteAccountViewProps {
  /** The code the message shows once the account is gone. */
  readonly message?: 'account-deleted' | undefined
  /** The code of the last failure. */
  readonly error?: string | undefined
  /** The link does not work: the button goes, and the error says to ask for a new one. */
  readonly linkDead: boolean
  /** Whether the flow takes the press now: the button is enabled while it does. */
  readonly canDelete: boolean
  /** Whether nobody is signed in here, the one who is led to the sign-in page from the message. */
  readonly guest: boolean
  /** Asks to delete the account; the frame's confirmation comes first. */
  readonly onDelete: () => void
  readonly link?: ComponentType<PageLinkProps>
}

/** The contract code of a failure, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'data:LINK_INVALID':
      return { code: 'link-invalid', text: t('user.delete-account.error.link-invalid') }
    case 'data:LINK_EXPIRED':
      return { code: 'link-expired', text: t('user.delete-account.error.link-expired') }
    case 'data:LAST_ADMIN':
      return { code: 'last-admin', text: t('user.delete-account.error.last-admin') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.delete-account.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.delete-account.error.failed') }
  }
}

/**
 * What the link of a deletion mail opens: what goes with the account (it names none: a device
 * that is not signed in cannot know whose it is) and the button that deletes it, then what came
 * of the press. The sign-in link is a guest's alone.
 */
export function DeleteAccountView(props: DeleteAccountViewProps) {
  const t = useT()
  const Link = props.link ?? PlainLink
  const error = props.error ? errorOf(t, props.error) : undefined
  const alert = error ? (
    <Alert variant="destructive">
      <AlertDescription data-testid="user.delete-account.error" data-code={error.code}>
        {error.text}
      </AlertDescription>
    </Alert>
  ) : null

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{t('user.delete-account.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {props.message ? (
            <>
              <Alert variant="success">
                <AlertDescription
                  data-testid="user.delete-account.message"
                  data-code={props.message}
                >
                  {t('user.delete-account.message.account-deleted')}
                </AlertDescription>
              </Alert>
              {props.guest ? (
                <Link
                  to="/sign-in"
                  className="text-sm underline"
                  data-testid="user.delete-account.sign-in-link"
                >
                  {t('user.delete-account.sign-in')}
                </Link>
              ) : null}
            </>
          ) : props.linkDead ? (
            alert
          ) : (
            <>
              <p className="text-sm">{t('user.delete-account.warning')}</p>
              {alert}
              <Button
                type="button"
                variant="destructive"
                disabled={!props.canDelete}
                onClick={props.onDelete}
                data-testid="user.delete-account.delete-button"
              >
                {t('user.delete-account.delete')}
              </Button>
            </>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
