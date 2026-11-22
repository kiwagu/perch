import { useId } from 'react'

import { useT } from '@workspace/i18n'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'
import { InputDialog } from '@workspace/ui/components/platform/input-dialog'
import { Field, FieldError, FieldLabel } from '@workspace/ui/components/ui/field'
import { Input } from '@workspace/ui/components/ui/input'

import { concernsOf } from '../../../../../platform/concerns'
import type { SignInEvent } from '../../../application/sign-in-machine'

export interface DeviceLimitDialogProps {
  /** Whether the flow's state renders the dialog. */
  readonly open: boolean
  /** Signs in all the same, which signs out the account's device seen least recently. */
  readonly onConfirm: () => void
  /** Goes back to the form, signing nothing in. */
  readonly onCancel: () => void
}

/** The question asked once a sign-in finds the account signed in on as many devices as it may be. */
export function DeviceLimitDialog(props: DeviceLimitDialogProps) {
  const t = useT()

  return (
    <ConfirmDialog
      open={props.open}
      title={t('user.sign-in.device-limit.title')}
      description={t('user.sign-in.device-limit.body')}
      confirmLabel={t('user.sign-in.device-limit.confirm')}
      cancelLabel={t('user.sign-in.device-limit.cancel')}
      destructive
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
      testId="user.sign-in.device-limit-dialog"
      code="device-limit"
    />
  )
}

export interface CodeDialogProps {
  /** Whether the flow's state renders the dialog. */
  readonly open: boolean
  /** What is typed in the code. */
  readonly code: string
  /** The code of the last refusal of the code, shown under the field it concerns. */
  readonly error?: string | undefined
  /** Whether the flow takes the event now: the confirmation is held exactly while it does not. */
  readonly can: (event: SignInEvent) => boolean
  /** A keystroke in the code. */
  readonly onType: (code: string) => void
  /** Signs in with the code as typed. */
  readonly onConfirm: () => void
  /** Goes back to the form, the sign-in starting again from the password. */
  readonly onCancel: () => void
}

/** The codes of `user.sign-in.code.error`. */
type CodeErrorCode = 'invalid-code' | 'failed'

/** The anchor of the error of the code, drawn under its field or above it. */
const CODE_ERROR_TEST_ID = 'user.sign-in.code.error'

/** The field each code of `user.sign-in.code.error` concerns, as the screen's `fields` say. */
const CODE_ERROR_FIELDS: Partial<Record<CodeErrorCode, 'code'>> = { 'invalid-code': 'code' }

/** The contract code of a refusal of the code, with its text: a code that is no code is as wrong as any. */
function codeErrorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: CodeErrorCode; text: string } {
  return code === 'data:INVALID_CODE' || code === 'sign-in:CODE_INVALID'
    ? { code: 'invalid-code', text: t('user.sign-in.code.error.invalid-code') }
    : { code: 'failed', text: t('user.sign-in.code.error.failed') }
}

/**
 * The dialog asking the code of the account's second factor once its password is right: a code
 * its authenticator app shows now, or a backup code. A wrong one shows under the field, and the
 * confirmation is held while the flow does not take it.
 */
export function CodeDialog(props: CodeDialogProps) {
  const t = useT()
  const ids = { code: useId(), error: useId() }
  const error = props.error ? codeErrorOf(t, props.error) : undefined
  const concerns = concernsOf(CODE_ERROR_FIELDS, error?.code)

  return (
    <InputDialog
      open={props.open}
      title={t('user.sign-in.code.title')}
      description={t('user.sign-in.code.body')}
      confirmLabel={t('user.sign-in.code.confirm')}
      cancelLabel={t('user.sign-in.code.cancel')}
      confirmDisabled={
        !props.can({ type: 'user.sign-in.code.dialog.confirm-button', code: props.code })
      }
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
      testId="user.sign-in.code.dialog"
      code="code-required"
    >
      <Field data-invalid={concerns === 'code' ? true : undefined}>
        <FieldLabel htmlFor={ids.code}>{t('user.sign-in.code.label')}</FieldLabel>
        <Input
          id={ids.code}
          value={props.code}
          onChange={(event) => props.onType(event.target.value)}
          autoComplete="one-time-code"
          aria-invalid={concerns === 'code' ? true : undefined}
          aria-describedby={error ? ids.error : undefined}
          data-testid="user.sign-in.code.code-input"
        />
        {error ? (
          <FieldError id={ids.error} data-testid={CODE_ERROR_TEST_ID} data-code={error.code}>
            {error.text}
          </FieldError>
        ) : null}
      </Field>
    </InputDialog>
  )
}
