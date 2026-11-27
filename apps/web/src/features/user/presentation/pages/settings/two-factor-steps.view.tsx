import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@workspace/ui/components/ui/field'
import { Form } from '@workspace/ui/components/ui/form'
import { Input } from '@workspace/ui/components/ui/input'

import { concernsOf } from '../../../../../platform/concerns'
import type { SettingsEvent } from '../../../application/settings/settings-machine'
import type { TwoFactorStart } from '../../../application/two-factor.service'

import { TWO_FACTOR_ERROR_FIELDS, type TwoFactorErrorCode } from './two-factor-error'

export interface KeyStepProps {
  /** The key to type, and its QR as the SVG `qrSvg` draws (markup of numbers only, never the text it encodes). */
  readonly start: Pick<TwoFactorStart, 'key' | 'qr'>
  /** What is typed in the code. */
  readonly code: string
  /** The last failure, drawn under the field it concerns: the code's. */
  readonly error?: { readonly code: TwoFactorErrorCode; readonly text: string } | undefined
  /** The anchor the section's error carries, which this step gives the one it draws. */
  readonly errorTestId: string
  /** Whether the flow takes the event now: a control is enabled exactly while it does. */
  readonly can: (event: SettingsEvent) => boolean
  readonly onCode: (code: string) => void
  /** Turns the second factor on with the code: resolves whether it did. */
  readonly onConfirm: () => Promise<boolean>
  readonly onStop: () => void
}

/**
 * The key for the authenticator app as text to type, with a QR code beside it that carries the
 * same key, and the field for the code the app then shows.
 */
export function KeyStep(props: KeyStepProps) {
  const t = useT()
  const ids = { code: useId(), error: useId() }
  const concerns = concernsOf(TWO_FACTOR_ERROR_FIELDS, props.error?.code)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t('user.settings.two-factor.key.hint')}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="size-40 shrink-0 overflow-hidden rounded-md [&>svg]:size-full"
          role="img"
          aria-label={t('user.settings.two-factor.key.qr')}
          // The picture is drawn from numbers alone, so it carries no markup of anyone's text.
          dangerouslySetInnerHTML={{ __html: props.start.qr }}
        />
        <code
          className="min-w-0 font-mono text-sm break-all select-all"
          data-testid="user.settings.two-factor.key-cell"
        >
          {props.start.key}
        </code>
      </div>
      <Form onSubmit={props.onConfirm}>
        <FieldGroup>
          <Field data-invalid={concerns === 'code' ? true : undefined}>
            <FieldLabel htmlFor={ids.code}>{t('user.settings.two-factor.code')}</FieldLabel>
            <Input
              id={ids.code}
              value={props.code}
              onChange={(event) => props.onCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              aria-invalid={concerns === 'code' ? true : undefined}
              aria-describedby={concerns === 'code' ? ids.error : undefined}
              data-testid="user.settings.two-factor.code-input"
            />
            {props.error && concerns === 'code' ? (
              <FieldError
                id={ids.error}
                data-testid={props.errorTestId}
                data-code={props.error.code}
              >
                {props.error.text}
              </FieldError>
            ) : null}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={
                !props.can({ type: 'user.settings.two-factor.confirm-button', code: props.code })
              }
              data-testid="user.settings.two-factor.confirm-button"
            >
              {t('user.settings.two-factor.confirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!props.can({ type: 'user.settings.two-factor.stop-button' })}
              onClick={props.onStop}
              data-testid="user.settings.two-factor.stop-button"
            >
              {t('user.settings.two-factor.stop')}
            </Button>
          </div>
        </FieldGroup>
      </Form>
    </div>
  )
}

export interface CodesStepProps {
  /** The backup codes just made. */
  readonly codes: readonly string[]
  readonly can: (event: SettingsEvent) => boolean
  readonly onHide: () => void
}

/** The backup codes, one per line, shown this once, with the button that hides them. */
export function CodesStep(props: CodesStepProps) {
  const t = useT()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t('user.settings.two-factor.codes.hint')}</p>
      <pre
        className="rounded-md bg-muted p-3 font-mono text-sm select-all"
        data-testid="user.settings.two-factor.codes-cell"
      >
        {props.codes.join('\n')}
      </pre>
      <Button
        type="button"
        variant="outline"
        disabled={!props.can({ type: 'user.settings.two-factor.hide-codes-button' })}
        onClick={props.onHide}
        data-testid="user.settings.two-factor.hide-codes-button"
      >
        {t('user.settings.two-factor.hide-codes')}
      </Button>
    </div>
  )
}
