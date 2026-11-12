/**
 * The organisations the signed-in identity belongs to, and the one this browser works in. Each
 * identity's memberships are kept under a key of their own (`perch.session.memberships.<identity>`):
 * a tab hears another tab's writes late, so one that still shows an account another tab signed
 * out may write its list after the next account signed in; under its own key that list overwrites
 * nothing of the next account's.
 */

import { type IdentityId, idSchemas } from '@workspace/ids'
import { type Membership, membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'

const MEMBERSHIPS_KEY_PREFIX = 'perch.session.memberships.'

/** The key of the memberships kept for `identity`; the tabs follow them. */
export function membershipsKeyOf(identity: IdentityId): string {
  return `${MEMBERSHIPS_KEY_PREFIX}${identity}`
}

/** Whether `key` is the key of an identity's memberships. */
export function isMembershipsKey(key: string): boolean {
  return key.startsWith(MEMBERSHIPS_KEY_PREFIX)
}

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
  storage.set(membershipsKeyOf(identity), JSON.stringify({ identity, memberships }))
}

/** Forgets the memberships kept for `identity`; those of other identities stay. */
export function forgetMemberships(storage: KeyValueStorage, identity: IdentityId): void {
  storage.remove(membershipsKeyOf(identity))
}

/** The memberships kept for `identity`; none when they were kept for another or do not parse. */
export function savedMemberships(
  storage: KeyValueStorage,
  identity: IdentityId,
): readonly Membership[] {
  const text = storage.get(membershipsKeyOf(identity))

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
