import type { ReactNode } from 'react'

import { useT } from '@workspace/i18n'
import type { IdentityId } from '@workspace/ids'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'

import type { OrganisationEvent, TenantRole } from '../../../application/organisation-machine'
import { roleOptions } from '../role-words'

export interface MemberItem {
  readonly id: IdentityId
  readonly email: string
  /** The role the row's select shows: the one being set while its change runs, else the listed one. */
  readonly role: TenantRole
  /** An administrator removes any member but itself. */
  readonly removable: boolean
}

/**
 * The members card: each member by its email with a role select that applies at once, and a
 * remove button on every row but the administrator's own; the invitation form goes under the
 * list, as `children`.
 */
export function OrganisationMembers(props: {
  readonly members: readonly MemberItem[] | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onSetRole: (id: IdentityId, role: TenantRole) => void
  readonly onRemove: (id: IdentityId) => void
  readonly children?: ReactNode
}) {
  const t = useT()

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('organisation.members.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.members ? (
          <ul className="flex flex-col gap-2" data-testid="organisation.members.list">
            {props.members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2"
                data-testid="organisation.members.item"
                data-id={member.id}
              >
                <span className="min-w-0 break-all">{member.email}</span>
                <span className="flex items-center gap-2">
                  <OptionSelect
                    label={t('organisation.members.role')}
                    value={member.role}
                    options={roleOptions(t)}
                    onChange={(role) => props.onSetRole(member.id, role)}
                    disabled={
                      !props.can({
                        type: 'organisation.members.role-select',
                        identity: member.id,
                        role: member.role,
                      })
                    }
                    testId="organisation.members.role-select"
                    holdsInput={false}
                  />
                  {member.removable ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !props.can({
                          type: 'organisation.members.remove-button',
                          identity: member.id,
                        })
                      }
                      onClick={() => props.onRemove(member.id)}
                      data-testid="organisation.members.remove-button"
                    >
                      {t('organisation.members.remove')}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {props.children}
      </CardContent>
    </Card>
  )
}
