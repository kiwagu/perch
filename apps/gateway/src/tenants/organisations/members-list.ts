import { okAsync, Result, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

import type { OrganisationLookup } from '../organisation-lookup'
import {
  identityIdOf,
  keyOf,
  type Member,
  type Tenant,
  type TenantMembership,
} from '../organisation-rows'
import type { TenantMembers } from '../tenant-members'

export interface MembersListOptions {
  readonly lookup: OrganisationLookup
  readonly members: TenantMembers
}

/** A write that settles one member row to the directory. */
type Settle = () => ResultAsync<void, DataError>

/**
 * The members of an organisation as the directory has them, which the organisation's own
 * database is settled to first: its `member` rows are the word its data is checked against, and
 * a change that failed between its two writes leaves them apart from the directory (a row no
 * membership wants, a membership without its row, another role). The directory is the authority,
 * so the list is read from it and each row is written or deleted to match.
 *
 * It runs in the organisation's turn (`AdminTurn`), where no change of the organisation's
 * memberships is between its two writes, so it never settles one of them half done.
 */
export class MembersList {
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers

  constructor(options: MembersListOptions) {
    this.#lookup = options.lookup
    this.#members = options.members
  }

  /**
   * The members of the organisation with their emails, the earliest membership first, once its
   * member rows hold what the directory holds: one row per membership, with its role, an
   * identity that is gone or not. An identity that is gone has its row kept and is not listed.
   * The writes run one after the other, a missing or wrong row first, then each row no membership
   * wants; the first failure answers (`data:WRITE_FAILED`), and the next list settles the rest.
   */
  list(tenant: Tenant): ResultAsync<readonly Member[], DataError> {
    return this.#lookup.membershipsOfTenant(tenant).andThen((memberships) =>
      this.#rolesHeld(tenant)
        .andThen((held) => this.#settle(tenant, memberships, held))
        .map(() => listed(memberships)),
    )
  }

  /** The roles the member rows of the organisation hold, by the identity of each. */
  #rolesHeld(tenant: Tenant): ResultAsync<ReadonlyMap<IdentityId, TenantRole>, DataError> {
    return this.#members
      .list(tenant.key)
      .andThen((rows) =>
        Result.combine(
          rows.map((row) => identityIdOf(keyOf(row.id)).map((id) => [id, row.role] as const)),
        ),
      )
      .map((entries) => new Map(entries))
  }

  /** Writes what the rows lack of `memberships` and deletes what they hold that is not in it. */
  #settle(
    tenant: Tenant,
    memberships: readonly TenantMembership[],
    held: ReadonlyMap<IdentityId, TenantRole>,
  ): ResultAsync<void, DataError> {
    const wanted = new Set(memberships.map(({ identity }) => identity))
    const writes: Settle[] = [
      ...memberships
        .filter(({ identity, role }) => held.get(identity) !== role)
        .map(
          ({ identity, role }): Settle =>
            () =>
              this.#members.add(tenant.key, identity, role),
        ),
      ...[...held.keys()]
        .filter((identity) => !wanted.has(identity))
        .map(
          (identity): Settle =>
            () =>
              this.#members.remove(tenant.key, identity),
        ),
    ]

    return writes.reduce((done, write) => done.andThen(write), okAsync<void, DataError>(undefined))
  }
}

/** The memberships whose identity still has an email, as members. */
function listed(memberships: readonly TenantMembership[]): Member[] {
  return memberships.flatMap(({ identity, role, email }): Member[] =>
    email === undefined ? [] : [{ identity: { id: identity, email }, role }],
  )
}
