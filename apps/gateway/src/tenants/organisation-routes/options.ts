import type { RequestLimits } from '../../limits/request-limits'
import type { FailureListener } from '../organisation-http'

export interface OrganisationRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: FailureListener
  /** The invitation and organisation creation limits. */
  readonly limits: Pick<RequestLimits, 'invite' | 'createOrganisation'>
}
