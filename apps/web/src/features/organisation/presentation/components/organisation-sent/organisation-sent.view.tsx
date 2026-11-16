import { useT } from '@workspace/i18n'
import type { InvitationId } from '@workspace/ids'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type { OrganisationEvent, TenantRole } from '../../../application/organisation-machine'
import { roleLabel } from '../role-words'

/** An invitation not accepted yet, as the administrator sees it. */
export interface SentItem {
  readonly id: InvitationId
  readonly email: string
  readonly role: TenantRole
}

/**
 * The invitations not accepted yet, newest first, each with the link to copy and the revoke
 * button; nothing is rendered while there is none.
 */
export function OrganisationSent(props: {
  readonly invitations: readonly SentItem[] | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onCopy: (id: InvitationId) => void
  readonly onRevoke: (id: InvitationId) => void
}) {
  const t = useT()

  if (props.invitations === undefined || props.invitations.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.sent.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2" data-testid="organisation.sent.list">
          {props.invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-wrap items-center justify-between gap-2"
              data-testid="organisation.sent.item"
              data-id={invitation.id}
            >
              <span className="min-w-0 break-all" data-testid="organisation.sent.email-cell">
                {invitation.email}
              </span>
              <span
                className="text-sm text-muted-foreground"
                data-testid="organisation.sent.role-badge"
                data-value={invitation.role}
              >
                {roleLabel(t, invitation.role)}
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !props.can({ type: 'organisation.sent.copy-button', invitation: invitation.id })
                  }
                  onClick={() => props.onCopy(invitation.id)}
                  data-testid="organisation.sent.copy-button"
                >
                  {t('organisation.sent.copy')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !props.can({
                      type: 'organisation.sent.revoke-button',
                      invitation: invitation.id,
                    })
                  }
                  onClick={() => props.onRevoke(invitation.id)}
                  data-testid="organisation.sent.revoke-button"
                >
                  {t('organisation.sent.revoke')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
