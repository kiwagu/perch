/**
 * The account's platform roles (`operator`) on this browser: one record per identity, each under
 * a key of its own (`perch.session.roles.<identity>`), so no write of one identity's roles
 * touches another's. Only the welcome of the tab that leads the browser's sync writes a record;
 * a console request the gateway refused as `not-operator` drops the role from the record of the
 * identity that asked; the sign-out removes the record of the identity it signs out.
 */

import { type IdentityId, idSchemas } from '@workspace/ids'
import { PLATFORM_ROLES, type PlatformRole } from '@workspace/kernel'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'

const ROLES_KEY_PREFIX = 'perch.session.roles.'

const savedRolesSchema = z.object({
  identity: idSchemas.identity.schema,
  roles: z.array(z.enum(PLATFORM_ROLES)),
})

/** The key of the record of `identity`'s roles. */
export function rolesKeyOf(identity: IdentityId): string {
  return `${ROLES_KEY_PREFIX}${identity}`
}

/** Whether `key` is the key of an identity's roles record. */
export function isRolesKey(key: string): boolean {
  return key.startsWith(ROLES_KEY_PREFIX)
}

/** Keeps the roles of `identity`, as a welcome told this device, in place of those kept before. */
export function saveRoles(
  storage: KeyValueStorage,
  identity: IdentityId,
  roles: readonly PlatformRole[],
): void {
  storage.set(rolesKeyOf(identity), JSON.stringify({ identity, roles }))
}

/**
 * The roles kept for `identity`; none without a record, from a record that does not parse, and
 * from one that names another identity.
 */
export function savedRoles(
  storage: KeyValueStorage,
  identity: IdentityId,
): readonly PlatformRole[] {
  const text = storage.get(rolesKeyOf(identity))

  if (text === undefined) {
    return []
  }

  try {
    const parsed = savedRolesSchema.safeParse(JSON.parse(text))

    return parsed.success && parsed.data.identity === identity ? parsed.data.roles : []
  } catch {
    return []
  }
}

/**
 * Rewrites the record of `identity` without `role`; an identity without a record, or whose record
 * does not hold the role, is left as it is: nothing is created.
 */
export function dropRole(storage: KeyValueStorage, identity: IdentityId, role: PlatformRole): void {
  const kept = savedRoles(storage, identity)

  if (kept.includes(role)) {
    saveRoles(
      storage,
      identity,
      kept.filter((each) => each !== role),
    )
  }
}

/** Removes the record of `identity`; the records of other identities stay. */
export function forgetRoles(storage: KeyValueStorage, identity: IdentityId): void {
  storage.remove(rolesKeyOf(identity))
}
