import { match, P } from 'ts-pattern'

import { type Ability, defineAbilityFor, NO_ABILITY, OWNER_ABILITY } from '@workspace/kernel'
import {
  identityRegions,
  type RegionRef,
  type ReplicaSchema,
  tenantKeyOf,
} from '@workspace/replica'
import type { ClientMessage, Membership } from '@workspace/replica/protocol'
import type { Actor } from '@workspace/replica/server'

/** A region the device may name, and who it pushes there as. */
export interface DeviceRegion {
  readonly ref: RegionRef
  readonly actor: Actor
}

/**
 * The regions an identity may name, by id, with what it may do in each: everything in its private
 * region, what its role allows in each organisation's region, nothing in a region without a role.
 */
export function regionsFor(
  identity: string,
  memberships: readonly Membership[],
  schema: ReplicaSchema,
): ReadonlyMap<string, DeviceRegion> {
  const roles = new Map(memberships.map((membership) => [membership.tenant.key, membership.role]))

  return new Map(
    identityRegions(identity, memberships).map((ref) => {
      const key = tenantKeyOf(ref)
      const role = key === undefined ? undefined : roles.get(key)
      // Only the private region is the identity's own; a tenant region without a role allows nothing.
      const ability: Ability =
        ref.kind === 'private'
          ? OWNER_ABILITY
          : role === undefined
            ? NO_ABILITY
            : defineAbilityFor({ id: identity, role }, schema)

      return [ref.id, { ref, actor: { id: identity, ability } }]
    }),
  )
}

/** The regions a message names. */
export function regionsOf(message: ClientMessage): readonly string[] {
  return match(message)
    .with({ type: P.union('hello', 'sign-out', 'renew') }, () => [])
    .with({ type: 'probe' }, ({ regions }) => regions)
    .with({ type: P.union('subscribe', 'pull', 'push', 'compact') }, ({ region }) => [region])
    .exhaustive()
}
