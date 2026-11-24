import type { SignInContext } from './context'
import { askCode, refusedSignIn, welcomed } from './effects'
import type { SignInAttempt } from './sign-in-actors'

/**
 * The sign-in the dialog's confirmation asks for: the form of the attempt that asked, which the
 * machine kept, signing out the device seen least recently.
 */
function confirmedInput({ context }: { readonly context: SignInContext }): SignInAttempt {
  return { form: context.attempt, signOutOldest: true }
}

/**
 * The states that ask about the limit of devices and sign in all the same once confirmed: the
 * dialog, which signs nothing in unless it is confirmed, and the sign-in that follows it, which
 * asks the code of an account whose second factor is on.
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
      onDone: [
        { target: 'code-anyway', guard: 'codeRequired', actions: ['keepOutcome', askCode] },
        { target: 'done', actions: welcomed },
      ],
      onError: refusedSignIn,
    },
  },
} as const
