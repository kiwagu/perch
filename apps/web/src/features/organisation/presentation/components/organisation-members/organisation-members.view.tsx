import { useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import type { IdentityId } from '@workspace/ids'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import type { OrganisationEvent } from '../../../application/organisation.machine'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'

export interface MemberItem {
  readonly id: IdentityId
  readonly email: string
  /** An administrator removes any member but itself. */
  readonly removable: boolean
}

export function OrganisationMembers(props: {
  readonly members: readonly MemberItem[] | undefined
  readonly error: string | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onInvite: (email: string) => Promise<boolean>
  readonly onRemove: (id: IdentityId) => void
}) {
  const t = useT()
  const emailId = useId()
  const [email, setEmail] = useState('')
  const invite = () => {
    const invited = props.onInvite(email)

    void invited.then((done) => {
      if (done) {
        setEmail('')
      }
    })

    return invited
  }

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
                className="flex items-center justify-between gap-2"
                data-testid="organisation.members.item"
                data-id={member.id}
              >
                <span className="min-w-0 break-all">{member.email}</span>
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
              </li>
            ))}
          </ul>
        ) : null}
        <Form onSubmit={invite} data-testid="organisation.invite.form">
          <Field data-invalid={props.error ? true : undefined}>
            <FieldLabel htmlFor={emailId}>{t('organisation.invite.email')}</FieldLabel>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
              aria-invalid={props.error ? true : undefined}
              data-testid="organisation.invite.email-input"
            />
            <OrganisationErrorLine code={props.error} testId="organisation.invite.error" />
            <Button
              type="submit"
              disabled={!props.can({ type: 'organisation.invite.submit-button', email })}
              data-testid="organisation.invite.submit-button"
            >
              {t('organisation.invite.submit')}
            </Button>
          </Field>
        </Form>
      </CardContent>
    </Card>
  )
}
