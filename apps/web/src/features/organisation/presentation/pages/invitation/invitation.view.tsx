import type { ComponentType, ReactNode } from 'react'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { FieldGroup } from '@workspace/ui/components/ui/field'

import type { InvitationErrorCode } from '../../../application/invitation.machine'
import type { TenantRole } from '../../../application/organisation-machine'
import { roleLabel } from '../../components/role-words'

/** The anchors only some states of the flow render that the page shows or leaves out. */
export type InvitationListed =
  | 'organisation.invitation.status'
  | 'organisation.invitation.heading'
  | 'organisation.invitation.role-badge'
  | 'organisation.invitation.message'
  | 'organisation.invitation.sign-in-link'
  | 'organisation.invitation.accept-button'
  | 'organisation.invitation.decline-button'

/** A link to a route: the view draws a plain one alone, and its container gives it the router's. */
export interface InvitationLinkProps {
  readonly to: string
  readonly className?: string | undefined
  readonly 'data-testid'?: string | undefined
  readonly children: ReactNode
}

const PlainLink = ({ to, ...props }: InvitationLinkProps) => <a href={to} {...props} />

export interface InvitationViewProps {
  /** The name of the organisation the invitation is to. */
  readonly organisation?: string | undefined
  /** The role the account takes when it accepts. */
  readonly joinAs?: TenantRole | undefined
  /** The code the message shows to a guest. */
  readonly message?: 'sign-in-to-accept' | undefined
  /** The code of the error the page shows. */
  readonly error?: InvitationErrorCode | undefined
  /** Whether the flow's state renders an anchor: the status, the invitation, the buttons, the link. */
  readonly renders: (anchor: InvitationListed) => boolean
  /** Whether the flow takes the press of each button now: a button is enabled while it does. */
  readonly canAccept: boolean
  readonly canDecline: boolean
  /** Whether nobody is signed in here, the one who is led to the sign-in page from the message. */
  readonly guest: boolean
  readonly onAccept: () => void
  readonly onDecline: () => void
  readonly link?: ComponentType<InvitationLinkProps>
}

/**
 * What the link of an invitation mail opens: the check of the link, the organisation and the
 * role (never the email the invitation was sent to), what the account may do with them (accept
 * or decline, or sign in first) and the error of a link that does not work or a press that
 * failed.
 */
export function InvitationView(props: InvitationViewProps) {
  const t = useT()
  const Link = props.link ?? PlainLink
  const { error, joinAs } = props
  const invitation = props.renders('organisation.invitation.heading')

  return (
    <Card className="mx-auto w-full max-w-sm">
      {invitation ? (
        <CardHeader>
          <CardTitle>
            <h1 data-testid="organisation.invitation.heading">{props.organisation}</h1>
          </CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>
        <FieldGroup>
          {props.renders('organisation.invitation.status') ? (
            <p role="status" data-testid="organisation.invitation.status" data-state="loading">
              {t('organisation.invitation.checking')}
            </p>
          ) : null}
          {joinAs !== undefined && props.renders('organisation.invitation.role-badge') ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="organisation.invitation.role-badge"
              data-value={joinAs}
            >
              {roleLabel(t, joinAs)}
            </p>
          ) : null}
          {props.message && props.renders('organisation.invitation.message') ? (
            <Alert>
              <AlertDescription
                data-testid="organisation.invitation.message"
                data-code={props.message}
              >
                {t('organisation.invitation.message.sign-in-to-accept')}
              </AlertDescription>
            </Alert>
          ) : null}
          {props.guest && props.renders('organisation.invitation.sign-in-link') ? (
            <Link
              to="/sign-in"
              className="text-sm underline"
              data-testid="organisation.invitation.sign-in-link"
            >
              {t('organisation.invitation.sign-in')}
            </Link>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription data-testid="organisation.invitation.error" data-code={error}>
                {errorText(t, error)}
              </AlertDescription>
            </Alert>
          ) : null}
          {props.renders('organisation.invitation.accept-button') ? (
            <Button
              type="button"
              disabled={!props.canAccept}
              onClick={props.onAccept}
              data-testid="organisation.invitation.accept-button"
            >
              {t('organisation.invitation.accept')}
            </Button>
          ) : null}
          {props.renders('organisation.invitation.decline-button') ? (
            <Button
              type="button"
              variant="outline"
              disabled={!props.canDecline}
              onClick={props.onDecline}
              data-testid="organisation.invitation.decline-button"
            >
              {t('organisation.invitation.decline')}
            </Button>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

/** The words of a code of the page's error. */
function errorText(t: ReturnType<typeof useT>, code: InvitationErrorCode): string {
  switch (code) {
    case 'link-invalid':
      return t('organisation.invitation.error.link-invalid')
    case 'link-expired':
      return t('organisation.invitation.error.link-expired')
    case 'rate-limited':
      return t('organisation.invitation.error.rate-limited')
    case 'other-account':
      return t('organisation.invitation.error.other-account')
    case 'invitation-gone':
      return t('organisation.invitation.error.invitation-gone')
    case 'already-member':
      return t('organisation.invitation.error.already-member')
    case 'failed':
      return t('organisation.invitation.error.failed')
  }
}
