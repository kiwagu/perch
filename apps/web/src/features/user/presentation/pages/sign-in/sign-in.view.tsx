import { useId, useState } from 'react'

import { useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import type { SessionNotice } from '../../../../../platform/session.port'
import type { Passwords } from '../../../domain/password-confirmation.rule'
import { PasswordRuleList } from '../../components/password-rule-list/password-rule-list'

/** The rules of a new password the list shows at sign-up, each with its item's anchor. */
const RULES = [
  { rule: 'length', testId: 'user.sign-in.password-rule-list.length-item' },
  { rule: 'characters', testId: 'user.sign-in.password-rule-list.characters-item' },
  { rule: 'digit', testId: 'user.sign-in.password-rule-list.digit-item' },
  { rule: 'uppercase', testId: 'user.sign-in.password-rule-list.uppercase-item' },
  { rule: 'lowercase', testId: 'user.sign-in.password-rule-list.lowercase-item' },
  { rule: 'symbol', testId: 'user.sign-in.password-rule-list.symbol-item' },
] as const

/** The anchor of the form's error, drawn above the fields or under the field its code concerns. */
const SIGN_IN_ERROR_TEST_ID = 'user.sign-in.error'

export interface SignInValues {
  readonly email: string
  readonly password: string
  /** The password typed again, at sign-up: held to the password, never sent. */
  readonly confirmation: string
  readonly name: string
}

/** The buttons the sign-in flow handles: each is enabled while the machine's state does. */
export type SignInControl = 'user.sign-in.submit-button' | 'user.sign-in.resend-button'

/** A password field: the password, or the password typed again. */
export type PasswordField = keyof Passwords

export interface SignInViewProps {
  readonly mode: 'sign-in' | 'sign-up'
  /** The code of the last failure, or of the password typed again differing. */
  readonly error?: string | undefined
  /**
   * Why the last session ended, when the person should know: `resend-after-sign-in` once the
   * device was signed out while it held changes it had not sent, `signed-out-elsewhere` once
   * another device signed it out, `password-changed-elsewhere` once a change of the account's
   * password did, `password-reset-elsewhere` once another tab set a new password through a reset
   * link, `delete-pending` while another tab still holds the data of the account signed out.
   */
  readonly notice?: SessionNotice | undefined
  /** The code of the message asking to open the verification mail, once a sign-up or a resend went through. */
  readonly mail?: 'check-your-mail' | undefined
  /** The address that mail went to, which `check-your-mail` names. */
  readonly sentTo?: string | undefined
  /** Whether the button that sends the verification mail again shows. */
  readonly showResend: boolean
  /** Whether the flow's state handles a button's event: the button is enabled while it does. */
  readonly can: (control: SignInControl) => boolean
  /** Signs in or up with the values: resolves whether it did. */
  readonly onSubmit: (values: SignInValues) => Promise<boolean>
  /** Switches the mode, with both passwords as typed. */
  readonly onToggleMode: (passwords: Passwords) => void
  /** A keystroke in a password at sign-up, with both passwords as they are after it. */
  readonly onTypePassword: (field: PasswordField, passwords: Passwords) => void
  /** Sends the verification mail to `email` again: resolves whether it did. */
  readonly onResend: (email: string) => Promise<boolean>
  /** Moves to asking for a reset mail, carrying the email as typed. */
  readonly onForgot: (email: string) => void
}

/** The contract code of a refusal, with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return { code: 'invalid-credentials', text: t('user.sign-in.error.invalid-credentials') }
    case 'data:EMAIL_NOT_VERIFIED':
      return { code: 'email-not-verified', text: t('user.sign-in.error.email-not-verified') }
    case 'data:SIGN_UP_REJECTED':
      return { code: 'sign-up-rejected', text: t('user.sign-in.error.sign-up-rejected') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.sign-in.error.rate-limited') }
    case 'data:OTHER_ACCOUNT':
      return { code: 'other-account', text: t('user.sign-in.error.other-account') }
    case 'profile:NAME_REQUIRED':
      return { code: 'name-required', text: t('user.sign-in.error.name-required') }
    case 'profile:NAME_TOO_LONG':
      return { code: 'name-too-long', text: t('user.sign-in.error.name-too-long') }
    case 'sign-in:PASSWORDS_DIFFER':
      return { code: 'passwords-differ', text: t('user.sign-in.error.passwords-differ') }
    default:
      return { code: 'failed', text: t('user.sign-in.error.failed') }
  }
}

/** The field a code of `user.sign-in.error` concerns, as the screen's `fields` say. */
const ERROR_FIELDS: Readonly<Record<string, keyof SignInValues>> = {
  'passwords-differ': 'confirmation',
}

/** The text of the notice the last session left. */
function noticeText(
  t: ReturnType<typeof useT>,
  notice: NonNullable<SignInViewProps['notice']>,
): string {
  switch (notice) {
    case 'resend-after-sign-in':
      return t('user.sign-in.notice.resend-after-sign-in')
    case 'signed-out-elsewhere':
      return t('user.sign-in.notice.signed-out-elsewhere')
    case 'password-changed-elsewhere':
      return t('user.sign-in.notice.password-changed-elsewhere')
    case 'password-reset-elsewhere':
      return t('user.sign-in.notice.password-reset-elsewhere')
    case 'delete-pending':
      return t('user.sign-in.notice.delete-pending')
  }
}

export function SignInView(props: SignInViewProps) {
  const t = useT()
  const ids = { email: useId(), password: useId(), confirmation: useId(), name: useId() }
  // The error under the password typed again describes that field while it shows there.
  const confirmationErrorId = useId()
  // The rules of a new password describe the password while an account is created.
  const rulesId = useId()
  const [values, setValues] = useState<SignInValues>({
    email: '',
    password: '',
    confirmation: '',
    name: '',
  })
  const signingUp = props.mode === 'sign-up'
  const title = signingUp ? t('user.sign-in.create-account') : t('user.sign-in.sign-in')
  const field = (name: keyof SignInValues) => ({
    id: ids[name],
    value: values[name],
    onChange: (event: { readonly target: { readonly value: string } }) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
  })
  // While creating an account, each keystroke in a password tells both passwords as typed.
  const password = (name: PasswordField) => ({
    ...field(name),
    onChange: (event: { readonly target: { readonly value: string } }) => {
      const next = { ...values, [name]: event.target.value }

      setValues(next)

      if (signingUp) {
        props.onTypePassword(name, { password: next.password, confirmation: next.confirmation })
      }
    },
  })
  const error = props.error ? errorOf(t, props.error) : undefined
  const concerns = error ? ERROR_FIELDS[error.code] : undefined

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={() => props.onSubmit(values)} data-testid="user.sign-in.form">
          <FieldGroup>
            {props.notice ? (
              <Alert>
                <AlertDescription
                  data-testid="user.sign-in.notice-message"
                  data-code={props.notice}
                >
                  {noticeText(t, props.notice)}
                </AlertDescription>
              </Alert>
            ) : null}
            {props.mail ? (
              <Alert>
                <AlertDescription data-testid="user.sign-in.mail-message" data-code={props.mail}>
                  {t('user.sign-in.mail.check-your-mail', { email: props.sentTo ?? '' })}
                </AlertDescription>
              </Alert>
            ) : null}
            {error && !concerns ? (
              <Alert variant="destructive">
                <AlertDescription data-testid={SIGN_IN_ERROR_TEST_ID} data-code={error.code}>
                  {error.text}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor={ids.email}>{t('user.sign-in.email')}</FieldLabel>
              <Input
                {...field('email')}
                type="email"
                autoComplete="email"
                required
                data-testid="user.sign-in.email-input"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.password}>{t('user.sign-in.password')}</FieldLabel>
              <PasswordInput
                {...password('password')}
                autoComplete={signingUp ? 'new-password' : 'current-password'}
                required
                aria-describedby={signingUp ? rulesId : undefined}
                showLabel={t('user.password.show')}
                hideLabel={t('user.password.hide')}
                testId="user.sign-in.password-input"
              />
              {signingUp ? (
                <PasswordRuleList
                  id={rulesId}
                  password={values.password}
                  testId="user.sign-in.password-rule-list"
                  items={RULES}
                />
              ) : null}
              {signingUp ? null : (
                // The flow moves, carrying the email typed; the address is there for a new tab.
                <a
                  href="/forgot-password"
                  className="self-start text-sm underline"
                  onClick={(event) => {
                    event.preventDefault()
                    props.onForgot(values.email)
                  }}
                  data-testid="user.sign-in.forgot-link"
                >
                  {t('user.sign-in.forgot')}
                </a>
              )}
            </Field>
            {signingUp ? (
              <Field data-invalid={concerns === 'confirmation' ? true : undefined}>
                <FieldLabel htmlFor={ids.confirmation}>
                  {t('user.sign-in.password-confirmation')}
                </FieldLabel>
                <PasswordInput
                  {...password('confirmation')}
                  autoComplete="new-password"
                  required
                  aria-invalid={concerns === 'confirmation' ? true : undefined}
                  aria-describedby={concerns === 'confirmation' ? confirmationErrorId : undefined}
                  showLabel={t('user.password.show')}
                  hideLabel={t('user.password.hide')}
                  testId="user.sign-in.password-confirmation-input"
                />
                {error && concerns === 'confirmation' ? (
                  <FieldError
                    id={confirmationErrorId}
                    data-testid={SIGN_IN_ERROR_TEST_ID}
                    data-code={error.code}
                  >
                    {error.text}
                  </FieldError>
                ) : null}
              </Field>
            ) : null}
            {signingUp ? (
              <Field>
                <FieldLabel htmlFor={ids.name}>{t('user.sign-in.name')}</FieldLabel>
                <Input
                  {...field('name')}
                  autoComplete="name"
                  required
                  data-testid="user.sign-in.name-input"
                />
              </Field>
            ) : null}
            <Button
              type="submit"
              disabled={!props.can('user.sign-in.submit-button')}
              data-testid="user.sign-in.submit-button"
            >
              {signingUp ? t('user.sign-in.sign-up') : t('user.sign-in.sign-in')}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() =>
                props.onToggleMode({ password: values.password, confirmation: values.confirmation })
              }
              data-testid="user.sign-in.toggle-button"
              data-value={signingUp ? 'sign-in' : 'sign-up'}
            >
              {signingUp ? t('user.sign-in.have-account') : t('user.sign-in.create-account')}
            </Button>
            {props.showResend ? (
              <Button
                type="button"
                variant="outline"
                disabled={!props.can('user.sign-in.resend-button')}
                onClick={() => void props.onResend(values.email)}
                data-testid="user.sign-in.resend-button"
              >
                {t('user.sign-in.resend')}
              </Button>
            ) : null}
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  )
}
