import { useT } from '@workspace/i18n'
import { FieldError } from '@workspace/ui/components/ui/field'

import { organisationErrorOf } from './organisation-error'

export function OrganisationErrorLine(props: {
  readonly code: string | undefined
  readonly testId: string
}) {
  const t = useT()
  const error = props.code ? organisationErrorOf(t, props.code) : undefined

  return error ? (
    <FieldError data-testid={props.testId} data-code={error.code}>
      {error.text}
    </FieldError>
  ) : null
}
