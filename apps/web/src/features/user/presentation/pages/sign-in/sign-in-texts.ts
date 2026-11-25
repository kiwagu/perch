import type { useT } from '@workspace/i18n'

import type { SessionNotice } from '../../../../../platform/session.port'

/** The codes of `user.sign-in.error`. */
export type SignInErrorCode =
  | 'invalid-credentials'
  | 'email-not-verified'
  | 'account-banned'
  | 'sign-up-rejected'
  | 'rate-limited'
  | 'other-account'
  | 'code-expired'
  | 'passkey-cancelled'
  | 'passkey-unknown'
  | 'name-required'
  | 'name-too-long'
  | 'passwords-differ'
  | 'failed'

/** The contract code of a refusal, with its text. */
export function errorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: SignInErrorCode; text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return { code: 'invalid-credentials', text: t('user.sign-in.error.invalid-credentials') }
    case 'data:EMAIL_NOT_VERIFIED':
      return { code: 'email-not-verified', text: t('user.sign-in.error.email-not-verified') }
    case 'data:ACCOUNT_BANNED':
      return { code: 'account-banned', text: t('user.sign-in.error.account-banned') }
    case 'data:SIGN_UP_REJECTED':
      return { code: 'sign-up-rejected', text: t('user.sign-in.error.sign-up-rejected') }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.sign-in.error.rate-limited') }
    case 'data:OTHER_ACCOUNT':
      return { code: 'other-account', text: t('user.sign-in.error.other-account') }
    case 'data:CODE_EXPIRED':
      return { code: 'code-expired', text: t('user.sign-in.error.code-expired') }
    case 'data:PASSKEY_CANCELLED':
      return { code: 'passkey-cancelled', text: t('user.sign-in.error.passkey-cancelled') }
    case 'data:PASSKEY_UNKNOWN':
      return { code: 'passkey-unknown', text: t('user.sign-in.error.passkey-unknown') }
    case 'profile:NAME_REQUIRED':
      return { code: 'name-required', text: t('user.sign-in.error.name-required') }
    case 'profile:NAME_TOO_LONG':
      return { code: 'name-too-long', text: t('user.sign-in.error.name-too-long') }
    case 'sign-in:PASSWORDS_DIFFER':
      return { code: 'passwords-differ', text: t('user.sign-in.error.passwords-differ') }
    default:
      return { code: 'failed', text: t('user.sign-in.error.failed') }
  }
}

/** The field each code of `user.sign-in.error` concerns, as the screen's `fields` say. */
export const ERROR_FIELDS: Partial<Record<SignInErrorCode, 'name' | 'confirmation'>> = {
  'name-required': 'name',
  'name-too-long': 'name',
  'passwords-differ': 'confirmation',
}

/** The text of the notice the last session left. */
export function noticeText(t: ReturnType<typeof useT>, notice: SessionNotice): string {
  switch (notice) {
    case 'account-banned':
      return t('user.sign-in.notice.account-banned')
    case 'resend-after-sign-in':
      return t('user.sign-in.notice.resend-after-sign-in')
    case 'signed-out-elsewhere':
      return t('user.sign-in.notice.signed-out-elsewhere')
    case 'password-changed-elsewhere':
      return t('user.sign-in.notice.password-changed-elsewhere')
    case 'device-limit-elsewhere':
      return t('user.sign-in.notice.device-limit-elsewhere')
    case 'password-reset-elsewhere':
      return t('user.sign-in.notice.password-reset-elsewhere')
    case 'delete-pending':
      return t('user.sign-in.notice.delete-pending')
  }
}
