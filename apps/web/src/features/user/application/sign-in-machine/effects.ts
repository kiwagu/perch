import { SIGN_IN_ERROR } from './context'

/** The effect showing the form's error: its one code, or the code of the failure among `codes`. */
export const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: SIGN_IN_ERROR, codes } }) as const

export const clearError = { type: 'clear', params: { anchor: SIGN_IN_ERROR } } as const

/** The welcome a sign-in that went through says, and the move to the profile. */
export const welcomed = [
  { type: 'show', params: { anchor: 'app-shell.notice-message', codes: ['welcome'] } },
  { type: 'navigate', params: { to: '/me' } },
] as const

/** The dialog asking whether to sign in past the limit of devices. */
export const askPastTheLimit = {
  type: 'show',
  params: { anchor: 'user.sign-in.device-limit-dialog', codes: ['device-limit'] },
} as const

/**
 * A refused sign-in: one of an email not verified yet offers the resend, any other goes back with
 * its code, a banned account's (`account-banned`) among them: no resend is offered for it.
 */
export const refusedSignIn = [
  {
    target: 'unverified',
    guard: 'emailNotVerified',
    actions: [showError('email-not-verified')],
  },
  {
    target: 'sign-in',
    actions: [
      showError('invalid-credentials', 'account-banned', 'rate-limited', 'other-account', 'failed'),
    ],
  },
] as const
