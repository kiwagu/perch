import { err, errAsync, ok, okAsync, Result, type ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, recordId } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import { identityByEmail } from '../auth/identity-by-email'

import { type OrganisationError, refused } from './organisation-refusal'
import {
  type IdentityRow,
  identityIdOf,
  keyOf,
  type Member,
  type MemberRow,
  type MembershipRow,
  reading,
  type Tenant,
  type TenantRow,
  toMembership,
  toTenant,
} from './organisation-rows'
import identitiesByIdStatement from './surql/identities-by-id.surql'
import membershipRoleStatement from './surql/membership-role.surql'
import membershipsOfStatement from './surql/memberships-of.surql'
import tenantByKeyStatement from './surql/tenant-by-key.surql'

/**
 * What the directory says of organisations, their memberships and the identities in them: the
 * reads every organisation command starts from.
 */
export class OrganisationLookup {
  readonly #directory: LocalDb

  /** `directory`: the directory database, opened as the gateway's namespace user. */
  constructor(directory: LocalDb) {
    this.#directory = directory
  }

  /** The ready organisations `identity` belongs to, with its role in each, by key. */
  membershipsOf(identity: IdentityId): ResultAsync<readonly Membership[], DataError> {
    return reading(
      this.#directory.db.query<[MembershipRow[]]>(membershipsOfStatement, {
        identity: recordId('identity', identity),
      }),
      `could not read the memberships of ${identity}`,
    ).map(([rows]) => rows.map(toMembership))
  }

  /** The directory's row of the organisation with `key`, if there is one. */
  tenantRow(key: string): ResultAsync<TenantRow | undefined, DataError> {
    return reading(
      this.#directory.db.query<[TenantRow | undefined]>(tenantByKeyStatement, { key }),
      `could not read organisation ${key}`,
    ).map(([row]) => row)
  }

  /** The ready organisation with `key`; one still provisioning is not there yet. */
  tenantOf(key: string): ResultAsync<Tenant, OrganisationError> {
    return this.tenantRow(key).andThen((row) =>
      row?.status === 'ready' ? okAsync(toTenant(row)) : errAsync(refused('no-such-tenant')),
    )
  }

  /** `actor`'s role in the organisation; an identity that does not belong to it is refused. */
  memberOf(actor: IdentityId, tenant: Tenant): ResultAsync<TenantRole, OrganisationError> {
    return this.membershipsOf(actor).andThen((memberships) => {
      const membership = memberships.find((each) => each.tenant.id === tenant.id)

      return membership ? okAsync(membership.role) : errAsync(refused('not-a-member'))
    })
  }

  /** The organisation, once `actor` proved to be one of its admins. */
  adminOf(actor: IdentityId, tenant: Tenant): ResultAsync<Tenant, OrganisationError> {
    return this.memberOf(actor, tenant).andThen((role) =>
      role === 'admin' ? okAsync(tenant) : errAsync(refused('not-admin')),
    )
  }

  /**
   * The identity that signs in with `email`, in any case, through the auth module's lookup; none
   * is refused.
   */
  identityByEmail(email: string): ResultAsync<Member['identity'], OrganisationError> {
    return identityByEmail(this.#directory, email).andThen((identity) =>
      identity ? ok(identity) : err(refused('no-such-identity')),
    )
  }

  /**
   * `identity`, while the directory still holds it; one whose account went is refused
   * `no-such-identity`.
   */
  existing(identity: IdentityId): ResultAsync<IdentityId, OrganisationError> {
    return reading(
      this.#directory.db.query<[IdentityRow[]]>(identitiesByIdStatement, {
        ids: [recordId('identity', identity)],
      }),
      `could not read identity ${identity}`,
    ).andThen(([rows]) =>
      rows.length > 0 ? okAsync(identity) : errAsync(refused('no-such-identity')),
    )
  }

  /** The role the directory holds for `identity` in the organisation; none when it is no member. */
  roleOf(tenant: Tenant, identity: IdentityId): ResultAsync<TenantRole | undefined, DataError> {
    return reading(
      this.#directory.db.query<[TenantRole | undefined]>(membershipRoleStatement, {
        identity: recordId('identity', identity),
        tenant: recordId('tenant', tenant.id),
      }),
      `could not read the role of ${identity} in ${tenant.key}`,
    ).map(([role]) => role)
  }

  /**
   * The members with the emails the directory holds for their identities, in the same order. A
   * member row whose identity is gone (the seed's sweep leaves such rows) is left out.
   */
  withEmails(key: string, rows: readonly MemberRow[]): ResultAsync<readonly Member[], DataError> {
    return Result.combine(
      rows.map((row) => identityIdOf(keyOf(row.id)).map((id) => ({ id, role: row.role }))),
    )
      .asyncAndThen((members) =>
        reading(
          this.#directory.db.query<[IdentityRow[]]>(identitiesByIdStatement, {
            ids: members.map((member) => recordId('identity', member.id)),
          }),
          `could not read the identities of the members of ${key}`,
        ).map(([identities]) => ({ members, identities })),
      )
      .map(({ members, identities }) => {
        const emails = new Map(identities.map((row) => [keyOf(row.id), row.email]))

        return members.flatMap(({ id, role }): Member[] => {
          const email = emails.get(id)

          return email === undefined ? [] : [{ identity: { id, email }, role }]
        })
      })
  }
}
