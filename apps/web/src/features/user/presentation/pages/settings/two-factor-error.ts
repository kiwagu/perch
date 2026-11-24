import type { useT } from '@workspace/i18n'

/** The codes of `user.settings.two-factor.error`. */
export type TwoFactorErrorCode =
  | 'invalid-credentials'
  | 'invalid-code'
  | 'two-factor-changed'
  | 'rate-limited'
  | 'failed'

/** The field each code of `user.settings.two-factor.error` concerns, as the screen's `fields` say. */
export const TWO_FACTOR_ERROR_FIELDS: Partial<Record<TwoFactorErrorCode, 'password' | 'code'>> = {
  'invalid-credentials': 'password',
  'invalid-code': 'code',
}

/** The contract code of a failure, with its text: a code that is no code is as wrong as any. */
export function twoFactorErrorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { readonly code: TwoFactorErrorCode; readonly text: string } {
  switch (code) {
    case 'data:INVALID_CREDENTIALS':
      return {
        code: 'invalid-credentials',
        text: t('user.settings.two-factor.error.invalid-credentials'),
      }
    case 'data:INVALID_CODE':
    case 'sign-in:CODE_INVALID':
      return { code: 'invalid-code', text: t('user.settings.two-factor.error.invalid-code') }
    case 'data:TWO_FACTOR_CHANGED':
      return {
        code: 'two-factor-changed',
        text: t('user.settings.two-factor.error.two-factor-changed'),
      }
    case 'data:RATE_LIMITED':
      return { code: 'rate-limited', text: t('user.settings.two-factor.error.rate-limited') }
    default:
      return { code: 'failed', text: t('user.settings.two-factor.error.failed') }
  }
}
