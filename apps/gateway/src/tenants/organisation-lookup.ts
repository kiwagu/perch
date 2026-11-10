import { err, errAsync, ok, okAsync, Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb, recordId } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { type Membership, type TenantRole, tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { type OrganisationError, refused } from './organisation-refusal'
import {
  type IdentityRow,
  identityIdOf,
  keyOf,
  type MembershipRow,
  reading,
  type Tenant,
  type TenantMembership,
  type TenantRow,
  toMembership,
  toTenant,
} from './organisation-rows'
import identitiesByIdStatement from './surql/identities-by-id.surql'
import membershipAdminsStatement from './surql/membership-admins.surql'
import membershipOfEmailStatement from './surql/membership-of-email.surql'
import membershipRoleStatement from './surql/membership-role.surql'
import membershipsOfStatement from './surql/memberships-of.surql'
import membershipsOfTenantStatement from './surql/memberships-of-tenant.surql'
import tenantByKeyStatement from './surql/tenant-by-key.surql'

/**
 * What `membership-admins.surql` answers: an array holding the one count of the admins an
 * organisation has, and nothing else.
 */
const adminCount = z.tuple([z.number().int().nonnegative()])

/** What `identities-by-id.surql` answers for one identity: its row's email, or no row. */
const emailRows = z.tuple([z.array(z.object({ email: z.string() }))])

/** What `membership-of-email.surql` answers: the role found, if any. */
const roleFound = z.tuple([tenantRole.nullish()])

/**
 * What `memberships-of-tenant.surql` answers: the rows of the organisation's memberships, the
 * identity still a driver's record id, with no email for an identity that is gone.
 */
const membershipsOfTenantRows = z.tuple([
  z.array(z.object({ identity: z.unknown(), role: tenantRole, email: z.string().optional() })),
])

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

  /** The email the directory holds for `identity`; none when its account is gone. */
  emailOf(identity: IdentityId): ResultAsync<string | undefined, DataError> {
    return reading(
      this.#directory.db.query(identitiesByIdStatement, {
        ids: [recordId('identity', identity)],
      }),
      `could not read the email of ${identity}`,
    ).andThen((answer) => {
      const parsed = emailRows.safeParse(answer)

      return parsed.success
        ? ok(parsed.data[0][0]?.email)
        : err(dataError('data:QUERY_FAILED', `the email of ${identity} has an unknown shape`))
    })
  }

  /**
   * The role held in the organisation by the member whose email is `email`, in any case; none
   * when no member has it. One statement over the organisation's memberships, the same work
   * whether the email has an account or not.
   */
  roleByEmail(tenant: Tenant, email: string): ResultAsync<TenantRole | undefined, DataError> {
    return reading(
      this.#directory.db.query(membershipOfEmailStatement, {
        tenant: recordId('tenant', tenant.id),
        email: email.toLowerCase(),
      }),
      `could not read who holds ${tenant.key} by email`,
    ).andThen((answer) => {
      const parsed = roleFound.safeParse(answer)

      return parsed.success
        ? ok(parsed.data[0] ?? undefined)
        : err(
            dataError(
              'data:QUERY_FAILED',
              `the member of ${tenant.key} found by email has an unknown shape`,
            ),
          )
    })
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

  /** How many admins the directory counts in the organisation. */
  adminsOf(tenant: Tenant): ResultAsync<number, DataError> {
    return reading(
      this.#directory.db.query(membershipAdminsStatement, {
        tenant: recordId('tenant', tenant.id),
      }),
      `could not count the admins of ${tenant.key}`,
    ).andThen((answer) => {
      const parsed = adminCount.safeParse(answer)

      return parsed.success
        ? ok(parsed.data[0])
        : err(
            dataError(
              'data:QUERY_FAILED',
              `the count of the admins of ${tenant.key} has an unknown shape`,
            ),
          )
    })
  }

  /**
   * The memberships of the organisation with the emails of their identities, the earliest
   * first: those the directory holds, whether the identity still exists (it has an email) or not
   * (the seed's sweep leaves such memberships).
   */
  membershipsOfTenant(tenant: Tenant): ResultAsync<readonly TenantMembership[], DataError> {
    return reading(
      this.#directory.db.query(membershipsOfTenantStatement, {
        tenant: recordId('tenant', tenant.id),
      }),
      `could not read the memberships of ${tenant.key}`,
    ).andThen((answer) => {
      const parsed = membershipsOfTenantRows.safeParse(answer)

      return parsed.success
        ? Result.combine(
            parsed.data[0].map(({ identity, role, email }) =>
              identityIdOf(keyOf(identity)).map((id) => ({ identity: id, role, email })),
            ),
          )
        : err(
            dataError(
              'data:QUERY_FAILED',
              `the memberships of ${tenant.key} have an unknown shape`,
            ),
          )
    })
  }
}
