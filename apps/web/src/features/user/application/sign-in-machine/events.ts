import type { FieldValues, NavigateParams } from '../../../../platform/flow-effects'
import type { Passwords } from '../../domain/password-confirmation.rule'
import type { SignInForm } from '../sign-in.service'

/**
 * The events of the screen's flow: the user acts on these anchors. A keystroke in either password
 * carries both as typed, and so does the switch of mode, which judges them on the way into sign-up;
 * the submit carries the password typed again beside the form, never sent with it, and the
 * confirmation of the dialog of the code carries the code as typed. The confirmation of the dialog
 * past the limit of devices carries nothing: it signs in all the same as the attempt that asked.
 */
export type SignInEvent =
  | ({ readonly type: 'user.sign-in.toggle-button' } & Passwords)
  | {
      readonly type: 'user.sign-in.submit-button'
      readonly form: SignInForm
      readonly confirmation: string
    }
  | ({ readonly type: 'user.sign-in.password-input' } & Passwords)
  | ({ readonly type: 'user.sign-in.password-confirmation-input' } & Passwords)
  | { readonly type: 'user.sign-in.resend-button'; readonly email: string }
  | {
      readonly type: 'user.sign-in.forgot-link'
      /** The email as typed, which the move to `user.forgot-password` carries. */
      readonly fields: { readonly 'user.sign-in.email-input': string }
    }
  | { readonly type: 'user.sign-in.device-limit-dialog.confirm-button' }
  | { readonly type: 'user.sign-in.device-limit-dialog.cancel-button' }
  | { readonly type: 'user.sign-in.passkey-button' }
  | { readonly type: 'user.sign-in.code.dialog.confirm-button'; readonly code: string }
  | { readonly type: 'user.sign-in.code.dialog.cancel-button' }

/** The params of the flow's effects: an anchor shows one of the codes or goes; the app moves to a path. */
export interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

export interface ClearParams {
  readonly anchor: string
}

export type { NavigateParams }

/**
 * What the machine asks of its host: a code shown or cleared outside the form, a move to a path,
 * with what the fields the move names hold.
 */
export type SignInEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate'; readonly fields?: FieldValues } & NavigateParams)
