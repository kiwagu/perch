import { type ComponentType, useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'

import { RESET_PASSWORDS_DIFFER } from '../../../application/reset-password.machine'
import type { Passwords } from '../../../domain/password-confirmation.rule'
import { type PageLinkProps, PlainLink } from '../../components/page-link/page-link'
import { PasswordRuleList } from '../../components/password-rule-list/password-rule-list'

/** The anchor of the page's error, drawn above the form or under the field its code concerns. */
const RESET_ERROR_TEST_ID = 'user.reset-password.error'

/** The rules of a new password the list shows, each with its item's anchor. */
const RULES = [
  { rule: 'length', testId: 'user.reset-password.password-rule-list.length-item' },
  { rule: 'characters', testId: 'user.reset-password.password-rule-list.characters-item' },
  { rule: 'digit', testId: 'user.reset-password.password-rule-list.digit-item' },
  { rule: 'uppercase', testId: 'user.reset-password.password-rule-list.uppercase-item' },
  { rule: 'lowercase', testId: 'user.reset-password.password-rule-list.lowercase-item' },
  { rule: 'symbol', testId: 'user.reset-password.password-rule-list.symbol-item' },
] as const

/** A password field: the new password, or the password typed again. */
export type ResetPasswordField = keyof Passwords

export interface ResetPasswordViewProps {
  /** The code the message shows once the password is the new one. */
  readonly message?: 'password-reset' | undefined
  /** The code of the last failure, or of the password typed again differing. */
  readonly error?: string | undefined
  /** The link does not work: the form goes, and a link asks for a new one. */
  readonly linkDead: boolean
  /** Whether the flow takes the submit now: the button is enabled while it does. */
  readonly canSubmit: boolean
  /** A keystroke in a password, with both passwords as they are after it. */
  readonly onTypePassword: (field: ResetPasswordField, passwords: Passwords) => void
  /** Sets the new password: resolves whether it did. */
  readonly onSubmit: (passwords: Passwords) => Promise<boolean>
  readonly link?: ComponentType<PageLinkProps>
}

/** The contract code of a failure, the field it concerns if any, and its text. */
function errorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: string; field?: ResetPasswordField; text: string } {
  switch (code) {
    case 'data:LINK_INVALID':
      return { code: 'link-invalid', text: t('user.reset-password.error.link-invalid') }
    case 'data:LINK_EXPIRED':
      return { code: 'link-expired', text: t('user.reset-password.error.link-expired') }
    case 'data:PASSWORD_REJECTED':
      return {
        code: 'password-rejected',
        field: 'password',
        text: t('user.reset-password.error.password-rejected'),
      }
    case RESET_PASSWORDS_DIFFER:
      return {
        code: 'passwords-differ',
        field: 'confirmation',
        text: t('user.reset-password.error.passwords-differ'),
      }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.reset-password.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.reset-password.error.failed') }
  }
}

/** What the link of a reset mail opens: the new password typed twice, then what came of it. */
export function ResetPasswordView(props: ResetPasswordViewProps) {
  const t = useT()
  const ids = { password: useId(), confirmation: useId(), rules: useId(), error: useId() }
  const [values, setValues] = useState<Passwords>({ password: '', confirmation: '' })
  const Link = props.link ?? PlainLink
  const error = props.error ? errorOf(t, props.error) : undefined
  const password = (field: ResetPasswordField) => ({
    id: ids[field],
    value: values[field],
    onChange: (event: { readonly target: { readonly value: string } }) => {
      const next = { ...values, [field]: event.target.value }

      setValues(next)
      props.onTypePassword(field, next)
    },
    required: true,
    autoComplete: 'new-password',
    'aria-invalid': error?.field === field ? true : undefined,
    'aria-describedby':
      [field === 'password' ? ids.rules : undefined, error?.field === field ? ids.error : undefined]
        .filter(Boolean)
        .join(' ') || undefined,
    showLabel: t('user.password.show'),
    hideLabel: t('user.password.hide'),
  })
  const underField = (field: ResetPasswordField) =>
    error?.field === field ? (
      <FieldError id={ids.error} data-testid={RESET_ERROR_TEST_ID} data-code={error.code}>
        {error.text}
      </FieldError>
    ) : null
  const aboveForm =
    error && error.field === undefined ? (
      <Alert variant="destructive">
        <AlertDescription data-testid={RESET_ERROR_TEST_ID} data-code={error.code}>
          {error.text}
        </AlertDescription>
      </Alert>
    ) : null

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{t('user.reset-password.title')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {props.message ? (
          <FieldGroup>
            <Alert variant="success">
              <AlertDescription data-testid="user.reset-password.message" data-code={props.message}>
                {t('user.reset-password.message.password-reset')}
              </AlertDescription>
            </Alert>
            <Link
              to="/sign-in"
              className="text-sm underline"
              data-testid="user.reset-password.sign-in-link"
            >
              {t('user.reset-password.sign-in')}
            </Link>
          </FieldGroup>
        ) : props.linkDead ? (
          <FieldGroup>
            {aboveForm}
            <Link
              to="/forgot-password"
              className="text-sm underline"
              data-testid="user.reset-password.forgot-link"
            >
              {t('user.reset-password.forgot')}
            </Link>
          </FieldGroup>
        ) : (
          <Form onSubmit={() => props.onSubmit(values)} data-testid="user.reset-password.form">
            <FieldGroup>
              {aboveForm}
              <Field data-invalid={error?.field === 'password' ? true : undefined}>
                <FieldLabel htmlFor={ids.password}>{t('user.reset-password.password')}</FieldLabel>
                <PasswordInput
                  {...password('password')}
                  testId="user.reset-password.password-input"
                />
                <PasswordRuleList
                  id={ids.rules}
                  password={values.password}
                  testId="user.reset-password.password-rule-list"
                  items={RULES}
                />
                {underField('password')}
              </Field>
              <Field data-invalid={error?.field === 'confirmation' ? true : undefined}>
                <FieldLabel htmlFor={ids.confirmation}>
                  {t('user.reset-password.password-confirmation')}
                </FieldLabel>
                <PasswordInput
                  {...password('confirmation')}
                  testId="user.reset-password.password-confirmation-input"
                />
                {underField('confirmation')}
              </Field>
              <Button
                type="submit"
                disabled={!props.canSubmit}
                data-testid="user.reset-password.submit-button"
              >
                {t('user.reset-password.submit')}
              </Button>
            </FieldGroup>
          </Form>
        )}
      </CardContent>
    </Card>
  )
}
