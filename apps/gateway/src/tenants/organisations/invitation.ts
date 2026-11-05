import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, recordId } from '@workspace/data'
import { type IdentityId, membershipIdFactory } from '@workspace/ids'

import type { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import { type Tenant, takenIn, writing } from '../organisation-rows'
import membershipAddStatement from '../surql/membership-add.surql'
import type { TenantMembers } from '../tenant-members'

export interface OrganisationInvitationOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly lookup: OrganisationLookup
  readonly members: TenantMembers
}

/**
 * The rows that make an invited identity a member of an organisation: its membership in the
 * directory, then its member row in the organisation's database.
 */
export class OrganisationInvitation {
  readonly #directory: LocalDb
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers

  constructor(options: OrganisationInvitationOptions) {
    this.#directory = options.directory
    this.#lookup = options.lookup
    this.#members = options.members
  }

  /**
   * Writes the membership of `identity` in the organisation, as a member, then its member row. An
   * identity already in is refused, once its member row is written again with the role the
   * directory holds: asking again completes an invite that failed after the membership.
   */
  admit(tenant: Tenant, identity: IdentityId): ResultAsync<void, OrganisationError> {
    return this.#join(tenant, identity).andThen(() =>
      this.#members.add(tenant.key, identity, 'member'),
    )
  }

  /**
   * The directory's membership of `identity` in the organisation, as a member; one it already
   * has is refused once its member row is restored.
   */
  #join(tenant: Tenant, identity: IdentityId): ResultAsync<void, OrganisationError> {
    return writing(
      this.#directory.db
        .query(membershipAddStatement, {
          id: membershipIdFactory.create(),
          identity: recordId('identity', identity),
          tenant: recordId('tenant', tenant.id),
          role: 'member',
        })
        .retry(),
      `could not add the membership of ${identity} in ${tenant.key}`,
    )
      .map(() => undefined)
      .orElse((error) =>
        takenIn('membership_identity_tenant', error)
          ? this.#restoreMember(tenant, identity).andThen(() =>
              errAsync<void, OrganisationError>(refused('already-member')),
            )
          : errAsync(error),
      )
  }

  /**
   * Writes the member row of an identity the directory already counts in the organisation, with
   * the role the directory holds; nothing when its membership is gone.
   */
  #restoreMember(tenant: Tenant, identity: IdentityId): ResultAsync<void, DataError> {
    return this.#lookup
      .roleOf(tenant, identity)
      .andThen((role) =>
        role === undefined ? okAsync(undefined) : this.#members.add(tenant.key, identity, role),
      )
  }
}
