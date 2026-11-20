import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { OptionSelect } from '@workspace/ui/components/platform/option-select'
import { Button } from '@workspace/ui/components/ui/button'
import { Field, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import { concernsOf } from '../../../../../platform/concerns'
import type { OrganisationEvent, TenantRole } from '../../../application/organisation-machine'
import {
  type OrganisationErrorCode,
  organisationErrorOf,
} from '../organisation-error-line/organisation-error'
import { OrganisationErrorLine } from '../organisation-error-line/organisation-error-line.view'
import { roleOptions } from '../role-words'

/** What the invitation form's fields hold: the email to invite and the role its account takes. */
export interface InviteDraft {
  readonly email: string
  readonly role: TenantRole
}

/** The field each code of `organisation.invite.error` concerns, as the screen's `fields` say. */
const ERROR_FIELDS: Partial<Record<OrganisationErrorCode, 'email'>> = {
  'email-invalid': 'email',
}

/**
 * The form that invites an email by a mailed link, with a role: a plain member until another is
 * chosen. Its error line says why the last invitation, copy of a link, revoke, change of a role,
 * removal, or read of the members or the invitations failed.
 */
export function OrganisationInvite(props: {
  readonly draft: InviteDraft
  readonly error: string | undefined
  /** Whether the page's flow takes the event now. */
  readonly can: (event: OrganisationEvent) => boolean
  readonly onChange: (draft: InviteDraft) => void
  readonly onInvite: (email: string, role: TenantRole) => Promise<boolean>
}) {
  const t = useT()
  const emailId = useId()
  const { draft } = props
  const error = props.error ? organisationErrorOf(t, props.error) : undefined
  const concerns = concernsOf(ERROR_FIELDS, error?.code)

  return (
    <Form
      onSubmit={() => props.onInvite(draft.email, draft.role)}
      data-testid="organisation.invite.form"
    >
      <Field data-invalid={concerns === 'email' ? true : undefined}>
        <FieldLabel htmlFor={emailId}>{t('organisation.invite.email')}</FieldLabel>
        <Input
          id={emailId}
          type="email"
          value={draft.email}
          onChange={(event) => props.onChange({ ...draft, email: event.target.value })}
          autoComplete="off"
          maxLength={254}
          aria-invalid={concerns === 'email' ? true : undefined}
          data-testid="organisation.invite.email-input"
        />
        <OptionSelect
          label={t('organisation.invite.role')}
          value={draft.role}
          options={roleOptions(t)}
          onChange={(role) => props.onChange({ ...draft, role })}
          testId="organisation.invite.role-select"
        />
        <OrganisationErrorLine code={props.error} testId="organisation.invite.error" />
        <Button
          type="submit"
          disabled={
            !props.can({
              type: 'organisation.invite.submit-button',
              email: draft.email,
              role: draft.role,
            })
          }
          data-testid="organisation.invite.submit-button"
        >
          {t('organisation.invite.submit')}
        </Button>
      </Field>
    </Form>
  )
}
