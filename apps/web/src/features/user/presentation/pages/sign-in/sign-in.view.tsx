import { useId, useState } from 'react'

import { useLocale, useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import { concernsOf } from '../../../../../platform/concerns'
import type { SessionNotice } from '../../../../../platform/session.port'
import type { SignInEvent } from '../../../application/sign-in-machine'
import type { Passwords } from '../../../domain/password-confirmation.rule'
import { PasswordRuleList } from '../../components/password-rule-list/password-rule-list'

import { CodeDialog, DeviceLimitDialog } from './sign-in-dialogs.view'
import { ERROR_FIELDS, errorOf, noticeText } from './sign-in-texts'

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

/** The anchors only some states of the flow render: each shows while the machine's state does. */
export type SignInListed =
  | 'user.sign-in.forgot-link'
  | 'user.sign-in.password-rule-list'
  | 'user.sign-in.password-confirmation-input'
  | 'user.sign-in.name-input'
  | 'user.sign-in.resend-button'
  | 'user.sign-in.passkey-button'
  | 'user.sign-in.device-limit-dialog'
  | 'user.sign-in.code.dialog'

/** A password field: the password, or the password typed again. */
export type PasswordField = keyof Passwords

export interface SignInViewProps {
  /** The email the field starts with: the one a page that moved here carried over, or none. */
  readonly startEmail: string
  /** The mode the heading, the buttons' words and the password's autocomplete name. */
  readonly mode: 'sign-in' | 'sign-up'
  /** The code of the last failure, or of the password typed again differing. */
  readonly error?: string | undefined
  /**
   * Why the last session ended, when the person should know: `resend-after-sign-in` once the
   * device was signed out while it held changes it had not sent, `signed-out-elsewhere` once
   * another device signed it out, `password-changed-elsewhere` once a change of the account's
   * password did, `device-limit-elsewhere` once a sign-in on another device went past the
   * account's limit of devices and signed out this one, seen least recently,
   * `password-reset-elsewhere` once another tab set a new password through a reset
   * link, `delete-pending` while another tab still holds the data of the account signed out.
   */
  readonly notice?: SessionNotice | undefined
  /** The code of the message asking to open the verification mail, once a sign-up or a resend went through. */
  readonly mail?: 'check-your-mail' | undefined
  /** The address that mail went to, which `check-your-mail` names. */
  readonly sentTo?: string | undefined
  /** Whether the flow's state renders an anchor: the anchor shows while it does. */
  readonly renders: (anchor: SignInListed) => boolean
  /** Whether the flow takes the event now: a button is enabled exactly while it does. */
  readonly can: (event: SignInEvent) => boolean
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
  /**
   * Signs in all the same past the account's limit of devices, with the values as typed: the
   * account's device seen least recently is signed out.
   */
  readonly onConfirmDeviceLimit: (values: SignInValues) => void
  /** Goes back to the form from the dialog past the limit of devices, signing nothing in. */
  readonly onCancelDeviceLimit: () => void
  /** What is typed in the code of the dialog of the second factor. */
  readonly code: string
  /** The code of the last refusal of the code, which the dialog shows under its field. */
  readonly codeError?: string | undefined
  /** A keystroke in the code. */
  readonly onTypeCode: (code: string) => void
  /** Signs in with the code as typed. */
  readonly onConfirmCode: () => void
  /** Goes back to the form from the dialog of the code: the sign-in starts again from the password. */
  readonly onCancelCode: () => void
  /** Signs in with a passkey, which the browser asks for. */
  readonly onPasskey: () => void
}

export function SignInView(props: SignInViewProps) {
  const t = useT()
  const locale = useLocale()
  const ids = { email: useId(), password: useId(), confirmation: useId(), name: useId() }
  // The error under a field describes that field while it shows there.
  const errorIds = { name: useId(), confirmation: useId() }
  // The rules of a new password describe the password while an account is created.
  const rulesId = useId()
  const [values, setValues] = useState<SignInValues>({
    email: props.startEmail,
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
  const concerns = concernsOf(ERROR_FIELDS, error?.code)
  const under = (key: 'name' | 'confirmation') =>
    error && concerns === key ? (
      <FieldError id={errorIds[key]} data-testid={SIGN_IN_ERROR_TEST_ID} data-code={error.code}>
        {error.text}
      </FieldError>
    ) : null

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
            {error && concerns === undefined ? (
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
                aria-describedby={
                  props.renders('user.sign-in.password-rule-list') ? rulesId : undefined
                }
                showLabel={t('user.password.show')}
                hideLabel={t('user.password.hide')}
                testId="user.sign-in.password-input"
              />
              {props.renders('user.sign-in.password-rule-list') ? (
                <PasswordRuleList
                  id={rulesId}
                  password={values.password}
                  testId="user.sign-in.password-rule-list"
                  items={RULES}
                />
              ) : null}
              {props.renders('user.sign-in.forgot-link') ? (
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
              ) : null}
            </Field>
            {props.renders('user.sign-in.password-confirmation-input') ? (
              <Field data-invalid={concerns === 'confirmation' ? true : undefined}>
                <FieldLabel htmlFor={ids.confirmation}>
                  {t('user.sign-in.password-confirmation')}
                </FieldLabel>
                <PasswordInput
                  {...password('confirmation')}
                  autoComplete="new-password"
                  required
                  aria-invalid={concerns === 'confirmation' ? true : undefined}
                  aria-describedby={concerns === 'confirmation' ? errorIds.confirmation : undefined}
                  showLabel={t('user.password.show')}
                  hideLabel={t('user.password.hide')}
                  testId="user.sign-in.password-confirmation-input"
                />
                {under('confirmation')}
              </Field>
            ) : null}
            {props.renders('user.sign-in.name-input') ? (
              <Field data-invalid={concerns === 'name' ? true : undefined}>
                <FieldLabel htmlFor={ids.name}>{t('user.sign-in.name')}</FieldLabel>
                <Input
                  {...field('name')}
                  autoComplete="name"
                  required
                  aria-invalid={concerns === 'name' ? true : undefined}
                  aria-describedby={concerns === 'name' ? errorIds.name : undefined}
                  data-testid="user.sign-in.name-input"
                />
                {under('name')}
              </Field>
            ) : null}
            <Button
              type="submit"
              disabled={
                !props.can({
                  type: 'user.sign-in.submit-button',
                  form: {
                    email: values.email,
                    password: values.password,
                    name: values.name,
                    locale,
                  },
                  confirmation: values.confirmation,
                })
              }
              data-testid="user.sign-in.submit-button"
            >
              {signingUp ? t('user.sign-in.sign-up') : t('user.sign-in.sign-in')}
            </Button>
            {props.renders('user.sign-in.passkey-button') ? (
              <Button
                type="button"
                variant="outline"
                disabled={!props.can({ type: 'user.sign-in.passkey-button' })}
                onClick={() => props.onPasskey()}
                data-testid="user.sign-in.passkey-button"
              >
                {t('user.sign-in.passkey')}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="link"
              disabled={
                !props.can({
                  type: 'user.sign-in.toggle-button',
                  password: values.password,
                  confirmation: values.confirmation,
                })
              }
              onClick={() =>
                props.onToggleMode({ password: values.password, confirmation: values.confirmation })
              }
              data-testid="user.sign-in.toggle-button"
              data-value={signingUp ? 'sign-in' : 'sign-up'}
            >
              {signingUp ? t('user.sign-in.have-account') : t('user.sign-in.create-account')}
            </Button>
            {props.renders('user.sign-in.resend-button') ? (
              <Button
                type="button"
                variant="outline"
                disabled={!props.can({ type: 'user.sign-in.resend-button', email: values.email })}
                onClick={() => void props.onResend(values.email)}
                data-testid="user.sign-in.resend-button"
              >
                {t('user.sign-in.resend')}
              </Button>
            ) : null}
          </FieldGroup>
        </Form>
        <DeviceLimitDialog
          open={props.renders('user.sign-in.device-limit-dialog')}
          onConfirm={() => props.onConfirmDeviceLimit(values)}
          onCancel={() => props.onCancelDeviceLimit()}
        />
        <CodeDialog
          open={props.renders('user.sign-in.code.dialog')}
          code={props.code}
          error={props.codeError}
          can={props.can}
          onType={props.onTypeCode}
          onConfirm={props.onConfirmCode}
          onCancel={props.onCancelCode}
        />
      </CardContent>
    </Card>
  )
}
