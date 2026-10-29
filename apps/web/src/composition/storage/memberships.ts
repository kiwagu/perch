/** The organisations the signed-in identity belongs to, and the one this browser works in. */

import { type IdentityId, idSchemas } from '@workspace/ids'
import { type Membership, membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'

/** The organisations the signed-in identity belongs to; the tabs follow them. */
export const MEMBERSHIPS_KEY = 'perch.session.memberships'

/** The organisation this browser works in. */
export const TENANT_KEY = 'perch.session.tenant'

const savedMembershipsSchema = z.object({
  identity: idSchemas.identity.schema,
  memberships: z.array(membership),
})

/** Keeps the organisations the identity belongs to, as the gateway last told this device. */
export function saveMemberships(
  storage: KeyValueStorage,
  identity: IdentityId,
  memberships: readonly Membership[],
): void {
  storage.set(MEMBERSHIPS_KEY, JSON.stringify({ identity, memberships }))
}

/** The memberships kept for `identity`; none when they were kept for another or do not parse. */
export function savedMemberships(
  storage: KeyValueStorage,
  identity: IdentityId,
): readonly Membership[] {
  const text = storage.get(MEMBERSHIPS_KEY)

  if (text === undefined) {
    return []
  }

  try {
    const parsed = savedMembershipsSchema.safeParse(JSON.parse(text))

    return parsed.success && parsed.data.identity === identity ? parsed.data.memberships : []
  } catch {
    return []
  }
}

/** Keeps the key of the organisation this browser works in. */
export function saveTenant(storage: KeyValueStorage, key: string): void {
  storage.set(TENANT_KEY, key)
}

/** The key of the organisation this browser works in, if one is kept. */
export function savedTenant(storage: KeyValueStorage): string | undefined {
  return storage.get(TENANT_KEY)
}
