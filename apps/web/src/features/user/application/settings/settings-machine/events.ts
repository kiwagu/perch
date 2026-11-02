import type { ResultAsync } from 'neverthrow'

import type { Locale } from '@workspace/i18n'

import type { ClearParams, ShowParams } from '../../../../../platform/flow-effects'
import type { Theme } from '../../../../../platform/theme'
import type { Passwords } from '../../../domain/password-confirmation.rule'
import type { SignInError } from '../../sign-in.service'

/** What the screen's guards read at the moment they are asked. */
export interface SettingsValues {
  /** The account's settings are on this device. */
  readonly held: boolean
  /** The account signed in on this device; none once it signed out. */
  readonly account: string | undefined
  /** The account the store under way began for. */
  readonly storingFor: string | undefined
}

/**
 * The events of the screen's flow: a choice of theme or language, a keystroke in the new password
 * or the password typed again (both carried as typed), the password form's save with the current
 * password beside them, and the email form's send.
 */
export type SettingsEvent =
  | { readonly type: 'user.settings.theme-select'; readonly theme: Theme }
  | { readonly type: 'user.settings.locale-select'; readonly locale: Locale }
  | ({ readonly type: 'user.settings.password.new-password-input' } & Passwords)
  | ({ readonly type: 'user.settings.password.password-confirmation-input' } & Passwords)
  | ({
      readonly type: 'user.settings.password.save-button'
      readonly currentPassword: string
    } & Passwords)
  | {
      readonly type: 'user.settings.email.send-button'
      readonly email: string
      readonly password: string
    }

/** What the screen keeps beside its state, for the view. */
export interface SettingsContext {
  /** The code of the password form's last failure, or of the password typed again differing. */
  readonly passwordError: string | undefined
  /** The code of the email form's last failure. */
  readonly emailError: string | undefined
  /** The code of the email form's message, once the mail to the new email went out. */
  readonly emailMessage: 'check-your-mail' | undefined
  /** The new email that mail went to, which the message names. */
  readonly sentTo: string | undefined
}

/**
 * What the machine asks of its host: a code shown or cleared on the frame, a field emptied, and the
 * language the app is to speak.
 */
export type SettingsEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | { readonly type: 'speak'; readonly locale: Locale }

export interface SettingsMachineDeps {
  readonly values: () => SettingsValues
  /** Shows a theme on this device and keeps it there. */
  readonly setTheme: (theme: Theme) => void
  /** Stores the language in the account's settings. */
  readonly storeLocale: (locale: Locale) => ResultAsync<void, unknown>
  /** Changes the account's password, signing its other devices out. */
  readonly changePassword: (
    currentPassword: string,
    password: string,
  ) => ResultAsync<void, SignInError>
  /** Asks to change the account's email: the mail goes to the new one. */
  readonly changeEmail: (email: string, password: string) => ResultAsync<void, SignInError>
}
