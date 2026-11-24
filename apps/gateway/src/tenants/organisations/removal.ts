import { type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb, recordId, tenantRegionId } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import { type Tenant, writing } from '../organisation-rows'
import membershipRemoveStatement from '../surql/membership-remove.surql'
import type { TenantMembers } from '../tenant-members'

import type { MembershipListeners } from './listeners'

export interface OrganisationRemovalOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly members: TenantMembers
  readonly listeners: MembershipListeners
  /**
   * Takes the region of an organisation an identity was removed from from that identity's open
   * connections at once; resolves once none of them may name it any more.
   */
  readonly revoke: (identity: IdentityId, region: string) => Promise<void>
}

/**
 * The removal of a member by an admin. Once the directory's membership is gone the
 * organisation's region is taken from the identity's open connections, before anything else can
 * fail; then its member row leaves the organisation's database and its listeners hear its
 * memberships, the telling whatever the delete's outcome, and the delete's outcome answering: a
 * telling that fails is retold later and fails nothing. It happens at every removal, also of an
 * identity that was no member: asking again after a failed delete revokes and tells again, and
 * completes the removal.
 */
export class OrganisationRemoval {
  readonly #directory: LocalDb
  readonly #members: TenantMembers
  readonly #listeners: MembershipListeners
  readonly #revoke: OrganisationRemovalOptions['revoke']

  constructor(options: OrganisationRemovalOptions) {
    this.#directory = options.directory
    this.#members = options.members
    this.#listeners = options.listeners
    this.#revoke = options.revoke
  }

  /** Takes `identity` out of the organisation. */
  remove(tenant: Tenant, identity: IdentityId): ResultAsync<void, DataError> {
    const { key } = tenant

    return writing(
      this.#directory.db
        .query(membershipRemoveStatement, {
          identity: recordId('identity', identity),
          tenant: recordId('tenant', tenant.id),
        })
        .retry(),
      `could not remove the membership of ${identity} in ${key}`,
    )
      .andThen(() =>
        ResultAsync.fromPromise(this.#revoke(identity, tenantRegionId(key)), (cause) =>
          dataError(
            'data:WRITE_FAILED',
            `could not take ${key} from the connections of ${identity}`,
            cause,
          ),
        ),
      )
      .andThen(() => this.#leaveTenant(key, identity))
  }

  /**
   * The member row of `identity` leaves the organisation's database, then its listeners hear its
   * memberships whatever the delete's outcome, and the delete's outcome answers: the telling
   * never fails.
   */
  #leaveTenant(key: string, identity: IdentityId): ResultAsync<void, DataError> {
    const run = async (): Promise<Result<void, DataError>> => {
      const deleted = await this.#members.remove(key, identity)
      const told = await this.#listeners.tell(identity)

      // The telling never fails, so the delete's outcome is the answer.
      return told.andThen(() => deleted)
    }

    return new ResultAsync(run())
  }
}
