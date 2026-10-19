import { useT } from '@workspace/i18n'
import { FieldError } from '@workspace/ui/components/ui/field'

function errorText(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'organisation:KEY_INVALID':
    case 'invalid-key':
      return t('organisation.error.key-invalid')
    case 'organisation:NAME_REQUIRED':
      return t('organisation.error.name-required')
    case 'organisation:NAME_TOO_LONG':
      return t('organisation.error.name-too-long')
    case 'key-taken':
      return t('organisation.error.key-taken')
    case 'no-such-identity':
      return t('organisation.error.no-such-identity')
    case 'already-member':
      return t('organisation.error.already-member')
    case 'rate-limited':
      return t('organisation.error.rate-limited')
    case 'not-admin':
      return t('organisation.error.not-admin')
    case 'note:FORBIDDEN':
      return t('organisation.error.forbidden')
    case 'note:TEXT_REQUIRED':
      return t('organisation.error.text-required')
    case 'note:TEXT_TOO_LONG':
      return t('organisation.error.text-too-long')
    default:
      return t('organisation.error.failed')
  }
}

export function OrganisationErrorLine(props: {
  readonly code: string | undefined
  readonly testId: string
}) {
  const t = useT()

  return props.code ? (
    <FieldError data-testid={props.testId}>{errorText(t, props.code)}</FieldError>
  ) : null
}
