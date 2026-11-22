import { type MouseEvent, useId } from 'react'

import { useT } from '@workspace/i18n'
import { PasswordInput } from '@workspace/ui/components/platform/password-input'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'

import { concernsOf } from '../../../../../platform/concerns'
import type { SettingsEvent } from '../../../application/settings/settings-machine'
import type { TwoFactorStart } from '../../../application/two-factor.service'

import { TWO_FACTOR_ERROR_FIELDS, twoFactorErrorOf } from './two-factor-error'
import { CodesStep, KeyStep } from './two-factor-steps.view'

/** The anchor of the section's error, drawn above the controls or under the field its code concerns. */
const ERROR_TEST_ID = 'user.settings.two-factor.error'

/**
 * A press that takes the password the form holds: it goes ahead only once the form's fields are
 * valid, as a submit does (the password is `required`), and the browser says which is not.
 */
const pressWhenValid = (press: () => void) => (event: MouseEvent<HTMLButtonElement>) => {
  if (event.currentTarget.form?.reportValidity()) {
    press()
  }
}

/** The marker of the second factor being on or off, which the page's anchors tell apart. */
function StateBadge(props: { readonly testId: string; readonly children: string }) {
  return (
    <span
      className="w-fit rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      data-testid={props.testId}
    >
      {props.children}
    </span>
  )
}

/** What the section knows of the second factor: not yet, not at all, or whether it is on. */
export type TwoFactorRead =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly enabled: boolean }

export interface TwoFactorSectionViewProps {
  readonly factor: TwoFactorRead
  /** Whether the flow's state renders an anchor: the step shown is the one the state renders. */
  readonly renders: (anchor: string) => boolean
  /** Whether the flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: SettingsEvent) => boolean
  /** The password typed, which the page holds: the flow's `clear` empties it. */
  readonly password: string
  /** The code typed for the key shown, which the page holds the same way. */
  readonly code: string
  /** The code of the last failure. */
  readonly error?: string | undefined
  /** The key being confirmed, while the flow shows it. */
  readonly start?: Pick<TwoFactorStart, 'key' | 'qr'> | undefined
  /** The backup codes just made, while the flow shows them. */
  readonly backupCodes?: readonly string[] | undefined
  readonly onPassword: (password: string) => void
  readonly onCode: (code: string) => void
  /** Starts turning it on with the password: resolves whether the key came. */
  readonly onEnable: () => Promise<boolean>
  readonly onDisable: () => void
  readonly onRenew: () => void
  /** Turns it on with the code: resolves whether it is on. */
  readonly onConfirm: () => Promise<boolean>
  readonly onStop: () => void
  readonly onHideCodes: () => void
}

/**
 * The account's second factor: whether it is on, and what the flow offers while it is: turning
 * it on (the password, then the key for the authenticator app and a code of it, then the ten
 * backup codes, once), turning it off and renewing the codes, each with the password. The step
 * shown is the one the flow's state renders.
 */
export function TwoFactorSectionView(props: TwoFactorSectionViewProps) {
  const t = useT()
  const ids = { password: useId(), error: useId() }
  const error = props.error ? twoFactorErrorOf(t, props.error) : undefined
  const ready = props.factor.status === 'ready'
  const asksPassword = ready && props.renders('user.settings.two-factor.password-input')
  const asksCode = props.start !== undefined && props.renders('user.settings.two-factor.code-input')
  const concerns = concernsOf(TWO_FACTOR_ERROR_FIELDS, error?.code)
  // An error shows under the field it concerns while that field is on screen, else above them all.
  const underItsField =
    (concerns === 'password' && asksPassword) || (concerns === 'code' && asksCode)
  const enabled = props.factor.status === 'ready' && props.factor.enabled
  const passwordField = (
    <Field data-invalid={concerns === 'password' ? true : undefined}>
      <FieldLabel htmlFor={ids.password}>{t('user.settings.two-factor.password')}</FieldLabel>
      <PasswordInput
        id={ids.password}
        value={props.password}
        onChange={(event) => props.onPassword(event.target.value)}
        autoComplete="current-password"
        required
        aria-invalid={concerns === 'password' ? true : undefined}
        aria-describedby={concerns === 'password' ? ids.error : undefined}
        showLabel={t('user.password.show')}
        hideLabel={t('user.password.hide')}
        testId="user.settings.two-factor.password-input"
      />
      {error && concerns === 'password' ? (
        <FieldError id={ids.error} data-testid={ERROR_TEST_ID} data-code={error.code}>
          {error.text}
        </FieldError>
      ) : null}
    </Field>
  )

  return (
    <Card
      className="mx-auto w-full max-w-md"
      data-testid="user.settings.two-factor.section"
      data-state={props.factor.status}
    >
      <CardHeader>
        <CardTitle>
          <h2>{t('user.settings.two-factor.title')}</h2>
        </CardTitle>
        <CardDescription>{t('user.settings.two-factor.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {props.factor.status === 'loading' ? (
          <p className="text-muted-foreground" role="status">
            {t('user.settings.two-factor.loading')}
          </p>
        ) : null}
        {props.factor.status === 'error' ? (
          <p className="text-destructive" role="alert">
            {t('user.settings.two-factor.unavailable')}
          </p>
        ) : null}
        {ready && enabled ? (
          <StateBadge testId="user.settings.two-factor.on-badge">
            {t('user.settings.two-factor.on')}
          </StateBadge>
        ) : null}
        {ready && !enabled ? (
          <StateBadge testId="user.settings.two-factor.off-badge">
            {t('user.settings.two-factor.off')}
          </StateBadge>
        ) : null}
        {error && !underItsField ? (
          <Alert variant="destructive">
            <AlertDescription data-testid={ERROR_TEST_ID} data-code={error.code}>
              {error.text}
            </AlertDescription>
          </Alert>
        ) : null}
        {asksPassword && !enabled ? (
          <Form onSubmit={props.onEnable}>
            <FieldGroup>
              {passwordField}
              <Button
                type="submit"
                disabled={
                  !props.can({
                    type: 'user.settings.two-factor.enable-button',
                    password: props.password,
                  })
                }
                data-testid="user.settings.two-factor.enable-button"
              >
                {t('user.settings.two-factor.enable')}
              </Button>
            </FieldGroup>
          </Form>
        ) : null}
        {asksPassword && enabled ? (
          // Turning it off and renewing the codes are two presses: Enter in the password chooses
          // neither, and each press is held to the form's validation as a submit is.
          <Form onSubmit={() => false}>
            <FieldGroup>
              {passwordField}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !props.can({
                      type: 'user.settings.two-factor.disable-button',
                      password: props.password,
                    })
                  }
                  onClick={pressWhenValid(props.onDisable)}
                  data-testid="user.settings.two-factor.disable-button"
                >
                  {t('user.settings.two-factor.disable')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !props.can({
                      type: 'user.settings.two-factor.renew-codes-button',
                      password: props.password,
                    })
                  }
                  onClick={pressWhenValid(props.onRenew)}
                  data-testid="user.settings.two-factor.renew-codes-button"
                >
                  {t('user.settings.two-factor.renew-codes')}
                </Button>
              </div>
            </FieldGroup>
          </Form>
        ) : null}
        {props.start && asksCode ? (
          <KeyStep
            start={props.start}
            code={props.code}
            error={error}
            errorTestId={ERROR_TEST_ID}
            can={props.can}
            onCode={props.onCode}
            onConfirm={props.onConfirm}
            onStop={props.onStop}
          />
        ) : null}
        {props.backupCodes && props.renders('user.settings.two-factor.codes-cell') ? (
          <CodesStep codes={props.backupCodes} can={props.can} onHide={props.onHideCodes} />
        ) : null}
      </CardContent>
    </Card>
  )
}
