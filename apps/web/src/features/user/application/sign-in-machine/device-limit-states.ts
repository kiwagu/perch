import { assertEvent } from 'xstate'

import type { SignInForm } from '../sign-in.service'

import { refusedSignIn, welcomed } from './effects'
import type { SignInEvent } from './events'

/** The sign-in the dialog's confirmation asks for: the form as typed, signing out the device seen least recently. */
function confirmedInput({ event }: { readonly event: SignInEvent }): {
  readonly form: SignInForm
  readonly signOutOldest: boolean
} {
  assertEvent(event, 'user.sign-in.device-limit-dialog.confirm-button')

  return { form: event.form, signOutOldest: true }
}

/**
 * The states that ask about the limit of devices and sign in all the same once confirmed: the
 * dialog, which signs nothing in unless it is confirmed, and the sign-in that follows it.
 */
export const DEVICE_LIMIT_STATES = {
  'device-limit': {
    meta: { renders: ['user.sign-in.forgot-link', 'user.sign-in.device-limit-dialog'] },
    on: {
      'user.sign-in.device-limit-dialog.confirm-button': { target: 'signing-in-anyway' },
      'user.sign-in.device-limit-dialog.cancel-button': { target: 'sign-in' },
    },
  },
  'signing-in-anyway': {
    meta: { renders: ['user.sign-in.forgot-link'] },
    invoke: {
      src: 'platform.sign-in',
      input: confirmedInput,
      onDone: { target: 'done', actions: welcomed },
      onError: refusedSignIn,
    },
  },
} as const
