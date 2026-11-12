import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { dataError, type LocalDb, recordId, tenantRegionId } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

import type { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import { type Tenant, writing } from '../organisation-rows'
import membershipSetRoleStatement from '../surql/membership-set-role.surql'
import type { TenantMembers } from '../tenant-members'

export interface OrganisationRoleChangeOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly lookup: OrganisationLookup
  readonly members: TenantMembers
  /**
   * Judges the pushes of an identity's open connections into the region of an organisation by the
   * role it has there from now on, at once; resolves once every one of them does.
   */
  readonly rerole: (identity: IdentityId, region: string, role: TenantRole) => Promise<void>
}

/**
 * The change of a member's role in an organisation. The directory holds the authority (who is an
 * admin, how many admins there are), so it is written last: a failure before its write leaves the
 * authority as it was, and asking again redoes the whole change, a self-demotion included, as its
 * actor is still an admin to the directory. Each write is the same again when repeated. Right
 * after the directory write, before anything can fail that tells the identity's devices, its open
 * connections push into the organisation's region as the new role allows, the role known without
 * a read, as a removal takes the region from them.
 */
export class OrganisationRoleChange {
  readonly #directory: LocalDb
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers
  readonly #rerole: OrganisationRoleChangeOptions['rerole']

  constructor(options: OrganisationRoleChangeOptions) {
    this.#directory = options.directory
    this.#lookup = options.lookup
    this.#members = options.members
    this.#rerole = options.rerole
  }

  /**
   * `identity` holds `role` in the organisation from now on: its member row first, then its
   * membership in the directory, then its open connections are re-judged. Decided from the directory's rows as they are now: refused
   * `no-such-member` for an identity that is no member, writing nothing, and `last-admin` for
   * the demotion of the only admin, once its member row is written again with the role the
   * directory holds (a half-done self-demotion of it, followed by the other admin's, would
   * otherwise show the only admin as a member for good). The role it already holds is written
   * again, which completes a change that was interrupted.
   */
  set(
    tenant: Tenant,
    identity: IdentityId,
    role: TenantRole,
  ): ResultAsync<void, OrganisationError> {
    return this.#allowed(tenant, identity, role)
      .andThen(() => this.#members.add(tenant.key, identity, role))
      .andThen(() => this.#inDirectory(tenant, identity, role))
      .andThen(() => this.#reroleConnections(tenant, identity, role))
  }

  /**
   * Whether `identity` is a member, and the change would not leave the organisation no admin;
   * a refusal for the last one restores the member row of that admin, and fails with the
   * restore's failure when that cannot be written.
   */
  #allowed(
    tenant: Tenant,
    identity: IdentityId,
    role: TenantRole,
  ): ResultAsync<void, OrganisationError> {
    return this.#lookup.roleOf(tenant, identity).andThen((current) => {
      if (current === undefined) {
        return errAsync<void, OrganisationError>(refused('no-such-member'))
      }

      if (current !== 'admin' || role === 'admin') {
        return okAsync<void, OrganisationError>(undefined)
      }

      return this.#lookup
        .adminsOf(tenant)
        .andThen((admins) =>
          admins > 1
            ? okAsync<void, OrganisationError>(undefined)
            : this.#members
                .add(tenant.key, identity, current)
                .andThen(() => errAsync<void, OrganisationError>(refused('last-admin'))),
        )
    })
  }

  /** The directory's membership of `identity` in the organisation holds `role`. */
  #inDirectory(
    tenant: Tenant,
    identity: IdentityId,
    role: TenantRole,
  ): ResultAsync<void, OrganisationError> {
    return writing(
      this.#directory.db
        .query(membershipSetRoleStatement, {
          identity: recordId('identity', identity),
          tenant: recordId('tenant', tenant.id),
          role,
        })
        .retry(),
      `could not set the role of ${identity} in ${tenant.key}`,
    ).map(() => undefined)
  }

  /** The open connections of `identity` push into the organisation's region as `role` allows. */
  #reroleConnections(
    tenant: Tenant,
    identity: IdentityId,
    role: TenantRole,
  ): ResultAsync<void, OrganisationError> {
    return ResultAsync.fromPromise(
      this.#rerole(identity, tenantRegionId(tenant.key), role),
      (cause) =>
        dataError(
          'data:WRITE_FAILED',
          `could not re-judge the pushes of ${identity} in ${tenant.key}`,
          cause,
        ),
    )
  }
}
