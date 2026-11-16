import { match, P } from 'ts-pattern'

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
  | 'email-invalid'
  | 'link-invalid'
  | 'link-expired'
  | 'invitation-gone'
  | 'other-account'

/** An organisation command refused for what was asked, not for a failure of the gateway. */
export interface OrganisationRefusal {
  readonly kind: 'refused'
  readonly code: OrganisationRefusalCode
}

export type OrganisationError = OrganisationRefusal | DataError

export function refused(code: OrganisationRefusalCode): OrganisationRefusal {
  return { kind: 'refused', code }
}

/** The HTTP status a route answers a refusal with. */
export function refusalStatus(code: OrganisationRefusalCode): number {
  return match(code)
    .with(P.union('invalid-key', 'invalid-name', 'email-invalid'), () => 400)
    .with(P.union('not-a-member', 'not-admin', 'other-account'), () => 403)
    .with(
      P.union('no-such-tenant', 'no-such-identity', 'no-such-member', 'link-invalid'),
      () => 404,
    )
    .with(P.union('key-taken', 'already-member', 'self', 'last-admin'), () => 409)
    .with(P.union('link-expired', 'invitation-gone'), () => 410)
    .exhaustive()
}
