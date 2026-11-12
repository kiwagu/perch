import {
  BAN_CODES,
  CHANGE_EMAIL_CODES,
  REMOVE_CODES,
  RENAME_CODES,
  RESEND_VERIFICATION_CODES,
  REVOKE_SESSIONS_CODES,
  SEND_RESET_CODES,
  UNBAN_CODES,
} from '../../../../platform/accounts.port'

/**
 * The effects of the card's flow, as its transitions list them, which `contract:flow
 * console.account` prints and `platform/machines.spec.ts` compares exactly: a code shown in an
 * area's error (the codes of the action that area runs) or in a toast, a field emptied, the card
 * read again, the move to the accounts.
 */

/** The areas of the card that show an error of their own, each by its error's anchor. */
export const AREA_ERRORS = {
  'console.account.name.error': 'name',
  'console.account.email.error': 'email',
  'console.account.ban.error': 'ban',
  'console.account.sessions.error': 'sessions',
  'console.account.reset.error': 'reset',
  'console.account.verification.error': 'verification',
  'console.account.removal.error': 'removal',
} as const

/** An area of the card that shows an error of its own. */
export type ErrorArea = (typeof AREA_ERRORS)[keyof typeof AREA_ERRORS]

/** The section the card reads its account into, which the flow reads again after an action. */
export const SECTION = 'console.account.section'

/** The fields the flow empties once their action is done. */
export const EMAIL_INPUT = 'console.account.email.email-input'
export const REASON_INPUT = 'console.account.ban.reason-input'

const shown = <Anchor extends keyof typeof AREA_ERRORS, Code extends string>(
  anchor: Anchor,
  codes: readonly Code[],
) => ({ type: 'show', params: { anchor, codes } }) as const

export const RENAME_REFUSED = shown('console.account.name.error', RENAME_CODES)
export const EMAIL_REFUSED = shown('console.account.email.error', CHANGE_EMAIL_CODES)
export const BAN_REFUSED = shown('console.account.ban.error', BAN_CODES)
export const UNBAN_REFUSED = shown('console.account.ban.error', UNBAN_CODES)
export const REVOKE_REFUSED = shown('console.account.sessions.error', REVOKE_SESSIONS_CODES)
export const RESET_REFUSED = shown('console.account.reset.error', SEND_RESET_CODES)
export const RESEND_REFUSED = shown('console.account.verification.error', RESEND_VERIFICATION_CODES)
export const REMOVE_REFUSED = shown('console.account.removal.error', REMOVE_CODES)

/** The toasts the contract derives for the actions on an account (`platform.yaml` `toasts`). */
const toast = <Code extends string>(code: Code) =>
  ({ type: 'show', params: { anchor: 'app-shell.toast', codes: [code] } }) as const

export const NAME_SAVED = toast('name-saved')
export const EMAIL_CHANGE_SENT = toast('email-change-sent')
export const BAN_SET = toast('ban-set')
export const BAN_LIFTED = toast('ban-lifted')
export const SESSIONS_REVOKED = toast('sessions-revoked')
export const RESET_SENT = toast('reset-sent')
export const VERIFICATION_SENT = toast('verification-sent')
export const ACCOUNT_REMOVED = toast('account-removed')

export const READ_SECTION = { type: 'read', params: { anchor: SECTION } } as const
export const CLEAR_EMAIL = { type: 'clear', params: { anchor: EMAIL_INPUT } } as const
export const CLEAR_REASON = { type: 'clear', params: { anchor: REASON_INPUT } } as const
export const TO_ACCOUNTS = { type: 'navigate', params: { to: '/console/users' } } as const

/** Forgets the error of an area once an action of that area was done. */
export const forget = (area: ErrorArea) => ({ type: 'forget', params: { area } }) as const
