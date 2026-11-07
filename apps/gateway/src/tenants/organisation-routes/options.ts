import type { Clock } from '@workspace/replica'

import type { RequestLimits } from '../../limits/request-limits'
import type { FailureListener } from '../organisation-http'

export interface OrganisationRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: FailureListener
  /** The invitation and organisation creation limits. */
  readonly limits: Pick<RequestLimits, 'inviteMail' | 'createOrganisation'>
  /** The gateway's clock: an accepted invite waits on it for its floor. */
  readonly clock: Clock
}
