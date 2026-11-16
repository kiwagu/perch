import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import type { AccountCard } from '../../../../../platform/accounts.port'
import type {
  AccountErrorCode,
  AccountErrors,
  AccountEvent,
} from '../../../application/account-machine/machine'
import { BAN_REASON_MAX } from '../../../domain/account-card.entity'

import { AreaError, areaErrorText } from './area-error.view'

/** The anchors of the errors drawn above their form or under the field their code concerns. */
const NAME_ERROR_TEST_ID = 'console.account.name.error'
const EMAIL_ERROR_TEST_ID = 'console.account.email.error'

/** What makes a control of the card a touch target: 44 by 44 CSS px at least. */
export const TOUCH_TARGET = 'min-h-11 min-w-11'

export interface AccountAreasProps {
  readonly account: AccountCard
  /** The code each area's error shows: that of its last refused action. */
  readonly errors: AccountErrors
  /** What the name field holds: the account's name as read, or what was typed since. */
  readonly name: string
  /** What the new email's field holds. */
  readonly email: string
  /** What the ban's reason holds. */
  readonly reason: string
  readonly onName: (name: string) => void
  readonly onEmail: (email: string) => void
  readonly onReason: (reason: string) => void
  /** Whether the card's flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: AccountEvent) => boolean
  /** Runs a control's event; resolves once its action ended, whether it was done. */
  readonly onAct: (event: AccountEvent) => Promise<boolean>
}

/** The codes of the name's error that concern its field, as the contract's `fields` map them. */
const NAME_FIELD: ReadonlySet<AccountErrorCode> = new Set(['name-required', 'name-too-long'])

/** The codes of the email's error that concern its field, as the contract's `fields` map them. */
const EMAIL_FIELD: ReadonlySet<AccountErrorCode> = new Set(['email-invalid', 'email-taken'])

/**
 * The name of the account's profile, shown while it has one; a code that concerns the name shows
 * under its field and marks it, any other above the form, or alone once there is no profile.
 */
function NameArea(props: AccountAreasProps) {
  const t = useT()
  const ids = { input: useId(), error: useId() }
  const code = props.errors.name
  const underField = props.account.hasProfile && code !== undefined && NAME_FIELD.has(code)
  const save = { type: 'console.account.name.save-button', name: props.name } as const

  return (
    <div className="flex flex-col gap-2">
      {code !== undefined && !underField ? (
        <AreaError testId={NAME_ERROR_TEST_ID} code={code} />
      ) : null}
      {props.account.hasProfile ? (
        <Form
          onSubmit={() => props.onAct(save)}
          className="flex flex-col gap-2"
          data-testid="console.account.name.form"
        >
          <Field data-invalid={underField ? true : undefined}>
            <FieldLabel htmlFor={ids.input}>{t('console.account.name.label')}</FieldLabel>
            <Input
              id={ids.input}
              value={props.name}
              onChange={(event) => props.onName(event.target.value)}
              aria-invalid={underField ? true : undefined}
              aria-describedby={underField ? ids.error : undefined}
              data-testid="console.account.name.name-input"
            />
            {underField ? (
              <FieldError id={ids.error} data-testid={NAME_ERROR_TEST_ID} data-code={code}>
                {areaErrorText(t, code)}
              </FieldError>
            ) : null}
          </Field>
          <Button
            type="submit"
            className={`${TOUCH_TARGET} self-start`}
            disabled={!props.can(save)}
            data-testid="console.account.name.save-button"
          >
            {t('console.account.name.save')}
          </Button>
        </Form>
      ) : null}
    </div>
  )
}

/**
 * The account's new email, to which the mail that confirms it goes; a code that concerns the
 * email shows under its field and marks it, any other above the form.
 */
function EmailArea(props: AccountAreasProps) {
  const t = useT()
  const ids = { input: useId(), error: useId() }
  const code = props.errors.email
  const underField = code !== undefined && EMAIL_FIELD.has(code)
  const send = { type: 'console.account.email.send-button', email: props.email } as const

  return (
    <Form
      onSubmit={() => props.onAct(send)}
      className="flex flex-col gap-2"
      data-testid="console.account.email.form"
    >
      {code !== undefined && !underField ? (
        <AreaError testId={EMAIL_ERROR_TEST_ID} code={code} />
      ) : null}
      <Field data-invalid={underField ? true : undefined}>
        <FieldLabel htmlFor={ids.input}>{t('console.account.email.label')}</FieldLabel>
        <Input
          id={ids.input}
          type="email"
          autoComplete="off"
          value={props.email}
          onChange={(event) => props.onEmail(event.target.value)}
          aria-invalid={underField ? true : undefined}
          aria-describedby={underField ? ids.error : undefined}
          data-testid="console.account.email.email-input"
        />
        {underField ? (
          <FieldError id={ids.error} data-testid={EMAIL_ERROR_TEST_ID} data-code={code}>
            {areaErrorText(t, code)}
          </FieldError>
        ) : null}
      </Field>
      <Button
        type="submit"
        className={`${TOUCH_TARGET} self-start`}
        disabled={!props.can(send)}
        data-testid="console.account.email.send-button"
      >
        {t('console.account.email.send')}
      </Button>
    </Form>
  )
}

/** Bans the account with an optional reason while it is not banned; lifts its ban while it is. */
function BanArea(props: AccountAreasProps) {
  const t = useT()
  const reasonId = useId()
  const code = props.errors.ban
  const ban = { type: 'console.account.ban.ban-button', reason: props.reason } as const
  const unban = { type: 'console.account.ban.unban-button' } as const
  const { banned } = props.account

  return (
    <Form
      onSubmit={() => props.onAct(banned ? unban : ban)}
      className="flex flex-col gap-2"
      data-testid="console.account.ban.form"
    >
      {code === undefined ? null : <AreaError testId="console.account.ban.error" code={code} />}
      {banned ? (
        <Button
          type="submit"
          variant="outline"
          className={`${TOUCH_TARGET} self-start`}
          disabled={!props.can(unban)}
          data-testid="console.account.ban.unban-button"
        >
          {t('console.account.ban.unban')}
        </Button>
      ) : (
        <>
          <Field>
            <FieldLabel htmlFor={reasonId}>{t('console.account.ban.reason')}</FieldLabel>
            <Input
              id={reasonId}
              value={props.reason}
              maxLength={BAN_REASON_MAX}
              onChange={(event) => props.onReason(event.target.value)}
              data-testid="console.account.ban.reason-input"
            />
          </Field>
          <Button
            type="submit"
            variant="destructive"
            className={`${TOUCH_TARGET} self-start`}
            disabled={!props.can(ban)}
            data-testid="console.account.ban.ban-button"
          >
            {t('console.account.ban.ban')}
          </Button>
        </>
      )}
    </Form>
  )
}

/**
 * The areas of the card that act on the account, each with its own error: its name (while it
 * has a profile), its email, its ban, its devices signed out everywhere, a password reset, its
 * verification mail again (while its email is not verified), and its removal.
 */
export function AccountAreasView(props: AccountAreasProps) {
  const t = useT()
  const { errors } = props
  const revoke = { type: 'console.account.sessions.revoke-button' } as const
  const reset = { type: 'console.account.reset.send-button' } as const
  const resend = { type: 'console.account.verification.resend-button' } as const
  const remove = { type: 'console.account.removal.remove-button' } as const

  return (
    <div className="flex flex-col gap-6">
      <NameArea {...props} />
      <EmailArea {...props} />
      <BanArea {...props} />
      <div className="flex flex-col gap-2">
        {errors.sessions === undefined ? null : (
          <AreaError testId="console.account.sessions.error" code={errors.sessions} />
        )}
        {errors.reset === undefined ? null : (
          <AreaError testId="console.account.reset.error" code={errors.reset} />
        )}
        {errors.verification === undefined ? null : (
          <AreaError testId="console.account.verification.error" code={errors.verification} />
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className={TOUCH_TARGET}
            disabled={!props.can(revoke)}
            onClick={() => void props.onAct(revoke)}
            data-testid="console.account.sessions.revoke-button"
          >
            {t('console.account.sessions.revoke')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className={TOUCH_TARGET}
            disabled={!props.can(reset)}
            onClick={() => void props.onAct(reset)}
            data-testid="console.account.reset.send-button"
          >
            {t('console.account.reset.send')}
          </Button>
          {props.account.emailVerified ? null : (
            <Button
              type="button"
              variant="outline"
              className={TOUCH_TARGET}
              disabled={!props.can(resend)}
              onClick={() => void props.onAct(resend)}
              data-testid="console.account.verification.resend-button"
            >
              {t('console.account.verification.resend')}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {errors.removal === undefined ? null : (
          <AreaError testId="console.account.removal.error" code={errors.removal} />
        )}
        <Button
          type="button"
          variant="destructive"
          className={`${TOUCH_TARGET} self-start`}
          disabled={!props.can(remove)}
          onClick={() => void props.onAct(remove)}
          data-testid="console.account.removal.remove-button"
        >
          {t('console.account.removal.remove')}
        </Button>
      </div>
    </div>
  )
}
