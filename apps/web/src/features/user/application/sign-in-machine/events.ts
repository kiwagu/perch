import type { FieldValues, NavigateParams } from '../../../../platform/flow-effects'
import type { Passwords } from '../../domain/password-confirmation.rule'
import type { SignInForm } from '../sign-in.service'

/**
 * The events of the screen's flow: the user acts on these anchors. A keystroke in either password
 * carries both as typed, and so does the switch of mode, which judges them on the way into sign-up;
 * the submit carries the password typed again beside the form, never sent with it.
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
      /** The email as typed, which the move to /forgot-password carries. */
      readonly fields: { readonly 'user.sign-in.email-input': string }
    }

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
