import type { DataError } from '@workspace/data'

export type OrganisationRefusalCode =
  | 'invalid-key'
  | 'invalid-name'
  | 'key-taken'
  | 'no-such-tenant'
  | 'not-a-member'
  | 'not-admin'
  | 'no-such-identity'
  | 'already-member'
  | 'self'
  | 'last-admin'
  | 'no-such-member'

/** An organisation command refused for what was asked, not for a failure of the gateway. */
export interface OrganisationRefusal {
  readonly kind: 'refused'
  readonly code: OrganisationRefusalCode
}

export type OrganisationError = OrganisationRefusal | DataError

export function refused(code: OrganisationRefusalCode): OrganisationRefusal {
  return { kind: 'refused', code }
}
