/**
 * The regions the gateway serves, told apart by their document ids: an identity's private
 * region `identity:<identity id>` and an organisation's tenant region `tenant:<key>`.
 */

import { tenantRegionId } from '@workspace/data'
import { isTenantKey } from '@workspace/kernel'

import type { Membership } from './protocol'
import type { RegionRef } from './region-doc'

/** The key an identity id starts with. */
const IDENTITY_KEY = /^idn_\S+$/

/** The key after the table of a document id, `<table>:<key>`. */
function keyOf(id: string): string {
  return id.slice(id.indexOf(':') + 1)
}

/** The region document of an identity's own records. */
export function privateRegionId(identity: string): string {
  return `identity:${identity}`
}

/** The region a document id names, or undefined for an id that names neither kind. */
export function regionRefOf(id: string): RegionRef | undefined {
  const key = keyOf(id)

  if (IDENTITY_KEY.test(key) && privateRegionId(key) === id) {
    return { kind: 'private', id }
  }

  if (isTenantKey(key) && tenantRegionId(key) === id) {
    return { kind: 'tenant', id }
  }

  return undefined
}

/** The regions an identity may name: its private region and the region of each of its organisations. */
export function identityRegions(
  identity: string,
  memberships: readonly Membership[],
): readonly RegionRef[] {
  return [
    { kind: 'private', id: privateRegionId(identity) },
    ...memberships.map(
      ({ tenant }): RegionRef => ({
        kind: 'tenant',
        id: tenantRegionId(tenant.key),
      }),
    ),
  ]
}

/** The key of the organisation a tenant region belongs to; undefined for any other region. */
export function tenantKeyOf(ref: RegionRef): string | undefined {
  const key = keyOf(ref.id)

  return ref.kind === 'tenant' && isTenantKey(key) && tenantRegionId(key) === ref.id
    ? key
    : undefined
}
