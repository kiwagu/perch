import { useT } from '@workspace/i18n'
import type { InvitationId } from '@workspace/ids'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type { OrganisationEvent, TenantRole } from '../../../application/organisation-machine'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'
import { roleLabel } from '../role-words'

/** An invitation to the signed-in account, as it sees it: the organisation and the role. */
export interface ReceivedItem {
  readonly id: InvitationId
  readonly name: string
  readonly role: TenantRole
}

/**
 * The invitations to the account's email, newest first, each with its accept and decline
 * buttons; what failed shows above them: a failed acceptance or decline beside the list, a
 * failed read alone (the page passes no list then). Nothing is rendered while there is none and
 * nothing failed.
 */
export function OrganisationReceived(props: {
  readonly invitations: readonly ReceivedItem[] | undefined
  readonly error: string | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onAccept: (id: InvitationId) => void
  readonly onDecline: (id: InvitationId) => void
}) {
  const t = useT()
  const { invitations } = props

  if (props.error === undefined && (invitations === undefined || invitations.length === 0)) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.received.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {props.error !== undefined && (
          <OrganisationErrorLine code={props.error} testId="organisation.received.error" />
        )}
        {invitations !== undefined && invitations.length > 0 && (
          <ul className="flex flex-col gap-2" data-testid="organisation.received.list">
            {invitations?.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-2"
                data-testid="organisation.received.item"
                data-id={invitation.id}
              >
                <span className="min-w-0 break-all" data-testid="organisation.received.name-cell">
                  {invitation.name}
                </span>
                <span
                  className="text-sm text-muted-foreground"
                  data-testid="organisation.received.role-badge"
                  data-value={invitation.role}
                >
                  {roleLabel(t, invitation.role)}
                </span>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    disabled={
                      !props.can({
                        type: 'organisation.received.accept-button',
                        invitation: invitation.id,
                      })
                    }
                    onClick={() => props.onAccept(invitation.id)}
                    data-testid="organisation.received.accept-button"
                  >
                    {t('organisation.received.accept')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !props.can({
                        type: 'organisation.received.decline-button',
                        invitation: invitation.id,
                      })
                    }
                    onClick={() => props.onDecline(invitation.id)}
                    data-testid="organisation.received.decline-button"
                  >
                    {t('organisation.received.decline')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
