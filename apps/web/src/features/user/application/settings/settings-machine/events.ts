import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { Locale } from '@workspace/i18n'
import type { PasskeyId, TwoFactorId } from '@workspace/ids'

import type { ClearParams, ShowParams } from '../../../../../platform/flow-effects'
import type { Theme } from '../../../../../platform/theme'
import type { Passwords } from '../../../domain/password-confirmation.rule'
import type { SignInError } from '../../sign-in.service'
import type { TwoFactorError, TwoFactorStart } from '../../two-factor.service'

/** The anchor a flow's `read` effect names: the section or the list to read again. */
export interface ReadParams {
  readonly anchor: string
}

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
 * password beside them, the email form's send, the deletion form's send with the current
 * password, the second factor's buttons (the three that confirm the password carry it, the
 * confirmation carries the code of the key) and the passkeys' add and remove (carrying the id).
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
  | { readonly type: 'user.settings.deletion.send-button'; readonly password: string }
  | { readonly type: 'user.settings.two-factor.enable-button'; readonly password: string }
  | { readonly type: 'user.settings.two-factor.disable-button'; readonly password: string }
  | { readonly type: 'user.settings.two-factor.renew-codes-button'; readonly password: string }
  | { readonly type: 'user.settings.two-factor.confirm-button'; readonly code: string }
  | { readonly type: 'user.settings.two-factor.stop-button' }
  | { readonly type: 'user.settings.two-factor.hide-codes-button' }
  | { readonly type: 'user.settings.passkeys.add-button' }
  | { readonly type: 'user.settings.passkeys.remove-button'; readonly passkey: PasskeyId }

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
  /** The code of the deletion form's last failure. */
  readonly deletionError: string | undefined
  /** The code of the deletion form's message, once the mail with the deletion link went out. */
  readonly deletionMessage: 'check-your-mail' | undefined
  /** The code of the second factor's last failure. */
  readonly twoFactorError: string | undefined
  /**
   * The start the key step shows: the key, its QR, its enrolment and the backup codes it made,
   * held from the answer of turning it on until the step ends. The second factor is still off.
   */
  readonly start: TwoFactorStart | undefined
  /** The backup codes shown once, until they are hidden or the region leaves them. */
  readonly backupCodes: readonly string[] | undefined
  /** The code of the passkeys' last failure. */
  readonly passkeysError: string | undefined
}

/**
 * What the machine asks of its host: a code shown or cleared on the frame, a field emptied, the
 * language the app is to speak, and a read again of the section or the list an anchor names.
 */
export type SettingsEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | { readonly type: 'speak'; readonly locale: Locale }
  | ({ readonly type: 'read' } & ReadParams)

export interface SettingsMachineDeps {
  readonly values: () => SettingsValues
  /** Shows a theme on this device and keeps it there. */
  readonly setTheme: (theme: Theme) => void
  /** Stores the theme in the account's settings. */
  readonly storeTheme: (theme: Theme) => ResultAsync<void, unknown>
  /** Stores the language in the account's settings. */
  readonly storeLocale: (locale: Locale) => ResultAsync<void, unknown>
  /** Changes the account's password, signing its other devices out. */
  readonly changePassword: (
    currentPassword: string,
    password: string,
  ) => ResultAsync<void, SignInError>
  /** Asks to change the account's email: the mail goes to the new one. */
  readonly changeEmail: (email: string, password: string) => ResultAsync<void, SignInError>
  /** Asks to delete the account: the mail with the link of the page that deletes it goes out. */
  readonly requestAccountDeletion: (password: string) => ResultAsync<void, SignInError>
  /** Starts turning the second factor on: the key, its QR, ten backup codes and the enrolment. */
  readonly enableTwoFactor: (password: string) => ResultAsync<TwoFactorStart, TwoFactorError>
  /** Turns it on with a code of the key the enrolment names. */
  readonly confirmTwoFactor: (
    code: string,
    enrolment: TwoFactorId,
  ) => ResultAsync<void, TwoFactorError>
  /** Turns it off. */
  readonly disableTwoFactor: (password: string) => ResultAsync<void, TwoFactorError>
  /** Replaces the backup codes: the ten new ones. */
  readonly renewCodes: (password: string) => ResultAsync<readonly string[], TwoFactorError>
  /** Has the browser make a passkey, which the gateway keeps. */
  readonly addPasskey: () => ResultAsync<void, DataError>
  /** Removes a passkey of the account. */
  readonly removePasskey: (passkey: PasskeyId) => ResultAsync<void, DataError>
}
