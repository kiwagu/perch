import type { IdentityId } from '@workspace/ids'

import type { RoleRead, RoleSet, TenantRole } from '../../../application/organisation-machine'

/**
 * The role a member's row shows: the one being set while its change runs, the one just set until
 * the members' read after that change settles (never the old role for a round trip), and the
 * listed one otherwise, which is what a refused change leaves.
 */
export function roleShown(row: {
  readonly identity: IdentityId
  readonly listed: TenantRole
  /** The role being set now, on any row. */
  readonly changing: RoleSet | undefined
  /** The roles set whose change is done, with the read of the members that confirms each. */
  readonly set: readonly RoleRead[]
  /** The count of changes the members' latest settled read was made after, if one settled. */
  readonly settled: number | undefined
}): TenantRole {
  if (row.changing?.identity === row.identity) {
    return row.changing.role
  }

  const awaiting = row.set.find(
    (each) =>
      each.identity === row.identity && (row.settled === undefined || each.read > row.settled),
  )

  return awaiting?.role ?? row.listed
}
