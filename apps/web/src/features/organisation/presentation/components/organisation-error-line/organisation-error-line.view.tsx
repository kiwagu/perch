import { useT } from '@workspace/i18n'
import { FieldError } from '@workspace/ui/components/ui/field'

/** The contract code of a refused change (a domain code or the gateway's), with its text. */
function errorOf(t: ReturnType<typeof useT>, code: string): { code: string; text: string } {
  switch (code) {
    case 'organisation:KEY_INVALID':
    case 'invalid-key':
      return { code: 'key-invalid', text: t('organisation.error.key-invalid') }
    case 'organisation:NAME_REQUIRED':
      return { code: 'name-required', text: t('organisation.error.name-required') }
    case 'organisation:NAME_TOO_LONG':
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

export function OrganisationErrorLine(props: {
  readonly code: string | undefined
  readonly testId: string
}) {
  const t = useT()
  const error = props.code ? errorOf(t, props.code) : undefined

  return error ? (
    <FieldError data-testid={props.testId} data-code={error.code}>
      {error.text}
    </FieldError>
  ) : null
}
