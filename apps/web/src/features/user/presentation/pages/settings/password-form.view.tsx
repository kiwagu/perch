import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'

import { SETTINGS_PASSWORDS_DIFFER } from '../../../application/settings/settings-machine'
import { PasswordRuleList } from '../../components/password-rule-list/password-rule-list'

/** The anchor of the form's error, drawn above the form or under the field its code concerns. */
const PASSWORD_ERROR_TEST_ID = 'user.settings.password.error'

/** The rules of a new password the list shows, each with its item's anchor. */
const RULES = [
  { rule: 'length', testId: 'user.settings.password-rule-list.length-item' },
  { rule: 'characters', testId: 'user.settings.password-rule-list.characters-item' },
  { rule: 'digit', testId: 'user.settings.password-rule-list.digit-item' },
  { rule: 'uppercase', testId: 'user.settings.password-rule-list.uppercase-item' },
  { rule: 'lowercase', testId: 'user.settings.password-rule-list.lowercase-item' },
  { rule: 'symbol', testId: 'user.settings.password-rule-list.symbol-item' },
] as const

/** What the form holds: the current password, the new one and the new one typed again. */
export interface PasswordFormValues {
  readonly current: string
  readonly password: string
  readonly confirmation: string
}

export interface PasswordFormViewProps {
  /** The values of the fields, which the page holds: a change empties them. */
  readonly values: PasswordFormValues
  /** The code of the last failure, or of the password typed again differing. */
  readonly error?: string | undefined
  /** Whether the flow takes the save now: the button is enabled while it does. */
  readonly canSave: boolean
  /** A keystroke in `field`, with every value as it is after it. */
  readonly onChange: (field: keyof PasswordFormValues, values: PasswordFormValues) => void
  /** Changes the password: resolves whether it did. */
  readonly onSave: () => Promise<boolean>
}

/** The contract code of a failure, the field it concerns if any, and its text. */
function errorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: string; field?: keyof PasswordFormValues; text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return {
        code: 'invalid-credentials',
        field: 'current',
        text: t('user.settings.password.error.invalid-credentials'),
      }
    case 'data:PASSWORD_REJECTED':
      return {
        code: 'password-rejected',
        field: 'password',
        text: t('user.settings.password.error.password-rejected'),
      }
    case SETTINGS_PASSWORDS_DIFFER:
      return {
        code: 'passwords-differ',
        field: 'confirmation',
        text: t('user.settings.password.error.passwords-differ'),
      }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.settings.password.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.settings.password.error.failed') }
  }
}

/** The account's password, changed with the current one; the account's other devices sign out. */
export function PasswordFormView(props: PasswordFormViewProps) {
  const t = useT()
  const ids = {
    current: useId(),
    password: useId(),
    confirmation: useId(),
    rules: useId(),
    error: useId(),
  }
  const error = props.error ? errorOf(t, props.error) : undefined
  const field = (name: keyof PasswordFormValues) => ({
    id: ids[name],
    value: props.values[name],
    onChange: (event: { readonly target: { readonly value: string } }) =>
      props.onChange(name, { ...props.values, [name]: event.target.value }),
    required: true,
    autoComplete: name === 'current' ? 'current-password' : 'new-password',
    'aria-invalid': error?.field === name ? true : undefined,
    'aria-describedby':
      [name === 'password' ? ids.rules : undefined, error?.field === name ? ids.error : undefined]
        .filter(Boolean)
        .join(' ') || undefined,
    showLabel: t('user.password.show'),
    hideLabel: t('user.password.hide'),
  })
  const underField = (name: keyof PasswordFormValues) =>
    error?.field === name ? (
      <FieldError id={ids.error} data-testid={PASSWORD_ERROR_TEST_ID} data-code={error.code}>
        {error.text}
      </FieldError>
    ) : null

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>
          <h2>{t('user.settings.password.title')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form onSubmit={props.onSave} data-testid="user.settings.password.form">
          <FieldGroup>
            {error && error.field === undefined ? (
              <Alert variant="destructive">
                <AlertDescription data-testid={PASSWORD_ERROR_TEST_ID} data-code={error.code}>
                  {error.text}
                </AlertDescription>
              </Alert>
            ) : null}
            <Field data-invalid={error?.field === 'current' ? true : undefined}>
              <FieldLabel htmlFor={ids.current}>{t('user.settings.password.current')}</FieldLabel>
              <PasswordInput
                {...field('current')}
                testId="user.settings.password.current-password-input"
              />
              {underField('current')}
            </Field>
            <Field data-invalid={error?.field === 'password' ? true : undefined}>
              <FieldLabel htmlFor={ids.password}>{t('user.settings.password.new')}</FieldLabel>
              <PasswordInput
                {...field('password')}
                testId="user.settings.password.new-password-input"
              />
              <PasswordRuleList
                id={ids.rules}
                password={props.values.password}
                testId="user.settings.password-rule-list"
                items={RULES}
              />
              {underField('password')}
            </Field>
            <Field data-invalid={error?.field === 'confirmation' ? true : undefined}>
              <FieldLabel htmlFor={ids.confirmation}>
                {t('user.settings.password.confirmation')}
              </FieldLabel>
              <PasswordInput
                {...field('confirmation')}
                testId="user.settings.password.password-confirmation-input"
              />
              {underField('confirmation')}
            </Field>
            <Button
              type="submit"
              disabled={!props.canSave}
              data-testid="user.settings.password.save-button"
            >
              {t('user.settings.password.save')}
            </Button>
          </FieldGroup>
        </Form>
      </CardContent>
    </Card>
  )
}
