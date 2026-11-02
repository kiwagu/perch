import { assertEvent } from 'xstate'

import { PASSWORD_ERROR } from './anchors'
import type { SettingsEvent } from './events'

/** The current password and the new one the save sent; the password typed again stays here. */
function changeInput({ event }: { readonly event: SettingsEvent }): {
  readonly currentPassword: string
  readonly password: string
} {
  assertEvent(event, 'user.settings.password.save-button')

  return { currentPassword: event.currentPassword, password: event.password }
}

const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: PASSWORD_ERROR, codes } }) as const
const clearError = { type: 'clear', params: { anchor: PASSWORD_ERROR } } as const
const clearField = (anchor: string) => ({ type: 'clear', params: { anchor } }) as const

/**
 * The region of the screen's flow that changes the account's password: the new password is held to
 * the rules of a new password and to the password typed again as either is typed, the save is
 * taken only while they agree, and a change empties the form and says so on the frame's toast; a
 * refusal leaves the form as typed.
 */
export const PASSWORD_REGION = {
  initial: 'password-weak',
  states: {
    // The list marks the rules the new password keeps; the password typed again waits to be
    // judged, and the save is not taken.
    'password-weak': {
      on: {
        'user.settings.password.new-password-input': [
          { guard: 'passwordBreaksRules' },
          { target: 'passwords-differ', guard: 'confirmationStrays' },
          { target: 'kept' },
        ],
      },
    },
    kept: {
      on: {
        'user.settings.password.new-password-input': [
          { target: 'password-weak', guard: 'passwordBreaksRules' },
          { target: 'passwords-differ', guard: 'confirmationStrays' },
        ],
        'user.settings.password.password-confirmation-input': {
          target: 'passwords-differ',
          guard: 'confirmationStrays',
        },
        'user.settings.password.save-button': [
          { target: 'passwords-differ', guard: 'passwordsDiffer' },
          { target: 'changing' },
        ],
      },
    },
    'passwords-differ': {
      entry: [showError('passwords-differ')],
      exit: [clearError],
      on: {
        'user.settings.password.new-password-input': [
          { target: 'password-weak', guard: 'passwordBreaksRules' },
          { target: 'kept', guard: 'confirmationFollows' },
        ],
        'user.settings.password.password-confirmation-input': {
          target: 'kept',
          guard: 'confirmationFollows',
        },
      },
    },
    changing: {
      entry: [clearError],
      invoke: {
        src: 'platform.change-password',
        input: changeInput,
        onDone: {
          target: 'password-weak',
          actions: [
            clearField('user.settings.password.current-password-input'),
            clearField('user.settings.password.new-password-input'),
            clearField('user.settings.password.password-confirmation-input'),
            { type: 'show', params: { anchor: 'app-shell.toast', codes: ['password-changed'] } },
          ],
        },
        onError: {
          target: 'kept',
          actions: [
            showError('invalid-credentials', 'password-rejected', 'rate-limited', 'failed'),
          ],
        },
      },
    },
  },
} as const
