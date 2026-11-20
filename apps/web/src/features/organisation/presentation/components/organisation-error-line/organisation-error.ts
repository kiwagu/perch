import type { useT } from '@workspace/i18n'

/** The codes of an error of the organisation page, whichever part of the page raised it. */
export type OrganisationErrorCode =
  | 'key-invalid'
  | 'name-required'
  | 'name-too-long'
  | 'key-taken'
  | 'already-member'
  | 'email-invalid'
  | 'invitation-gone'
  | 'other-account'
  | 'rate-limited'
  | 'not-admin'
  | 'last-admin'
  | 'forbidden'
  | 'text-required'
  | 'text-too-long'
  | 'failed'

/**
 * The contract code of a refused change, with its text: the gateway's code, which is the contract's
 * as it is sent, or the code of a domain rule the app holds the form to itself (`organisation:…`,
 * `note:…`).
 */
export function organisationErrorOf(
  t: ReturnType<typeof useT>,
  code: string,
): { code: OrganisationErrorCode; text: string } {
  switch (code) {
    case 'organisation:KEY_INVALID':
    case 'key-invalid':
      return { code: 'key-invalid', text: t('organisation.error.key-invalid') }
    case 'organisation:NAME_REQUIRED':
    case 'name-required':
      return { code: 'name-required', text: t('organisation.error.name-required') }
    case 'organisation:NAME_TOO_LONG':
    case 'name-too-long':
      return { code: 'name-too-long', text: t('organisation.error.name-too-long') }
    case 'key-taken':
      return { code: 'key-taken', text: t('organisation.error.key-taken') }
    case 'already-member':
      return { code: 'already-member', text: t('organisation.error.already-member') }
    case 'email-invalid':
      return { code: 'email-invalid', text: t('organisation.error.email-invalid') }
    case 'invitation-gone':
      return { code: 'invitation-gone', text: t('organisation.error.invitation-gone') }
    case 'other-account':
      return { code: 'other-account', text: t('organisation.error.other-account') }
    case 'rate-limited':
      return { code: 'rate-limited', text: t('organisation.error.rate-limited') }
    case 'not-admin':
      return { code: 'not-admin', text: t('organisation.error.not-admin') }
    case 'last-admin':
      return { code: 'last-admin', text: t('organisation.error.last-admin') }
    case 'note:FORBIDDEN':
      return { code: 'forbidden', text: t('organisation.error.forbidden') }
    case 'note:TEXT_REQUIRED':
      return { code: 'text-required', text: t('organisation.error.text-required') }
    case 'note:TEXT_TOO_LONG':
      return { code: 'text-too-long', text: t('organisation.error.text-too-long') }
    default:
      return { code: 'failed', text: t('organisation.error.failed') }
  }
}
