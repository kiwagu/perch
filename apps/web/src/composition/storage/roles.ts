/**
 * The account's platform roles (`operator`) on this browser: one record per sign-in, each under a
 * key of its own (`perch.session.roles.<sign-in>`) naming the identity it is of, so no write of
 * one sign-in's roles touches another's, and the ending of one removes nothing of the next. Only
 * the welcome of the tab that leads the browser's sync writes a record; a console request the
 * gateway refused as `not-operator` drops the role from the current sign-in's record while it is
 * of the identity that asked; the ending of a sign-in removes its record.
 */

import { idSchemas } from '@workspace/ids'
import { PLATFORM_ROLES, type PlatformRole } from '@workspace/kernel'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'
import type { SignInId, SignInOwner } from './sign-in'

const ROLES_KEY_PREFIX = 'perch.session.roles.'

const savedRolesSchema = z.object({
  identity: idSchemas.identity.schema,
  roles: z.array(z.enum(PLATFORM_ROLES)),
})

/** The key of the record of sign-in `signIn`'s roles. */
export function rolesKeyOf(signIn: SignInId): string {
  return `${ROLES_KEY_PREFIX}${signIn}`
}

/** Whether `key` is the key of a sign-in's roles record. */
export function isRolesKey(key: string): boolean {
  return key.startsWith(ROLES_KEY_PREFIX)
}

/** Keeps the roles of `owner`'s identity, as a welcome told this device, in place of those kept before. */
export function saveRoles(
  storage: KeyValueStorage,
  owner: SignInOwner,
  roles: readonly PlatformRole[],
): void {
  storage.set(rolesKeyOf(owner.signIn), JSON.stringify({ identity: owner.identity, roles }))
}

/**
 * The roles kept for `owner`'s sign-in; none without a record, from a record that does not
 * parse, and from one that names another identity.
 */
export function savedRoles(storage: KeyValueStorage, owner: SignInOwner): readonly PlatformRole[] {
  const text = storage.get(rolesKeyOf(owner.signIn))

  if (text === undefined) {
    return []
  }

  try {
    const parsed = savedRolesSchema.safeParse(JSON.parse(text))

    return parsed.success && parsed.data.identity === owner.identity ? parsed.data.roles : []
  } catch {
    return []
  }
}

/**
 * Rewrites the record of `owner`'s sign-in without `role`; a sign-in without a record, or whose
 * record does not hold the role, is left as it is: nothing is created.
 */
export function dropRole(storage: KeyValueStorage, owner: SignInOwner, role: PlatformRole): void {
  const kept = savedRoles(storage, owner)

  if (kept.includes(role)) {
    saveRoles(
      storage,
      owner,
      kept.filter((each) => each !== role),
    )
  }
}

/** Removes the record of sign-in `signIn`; the records of other sign-ins stay. */
export function forgetRoles(storage: KeyValueStorage, signIn: SignInId): void {
  storage.remove(rolesKeyOf(signIn))
}
