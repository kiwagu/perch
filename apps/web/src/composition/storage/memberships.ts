/**
 * The organisations the signed-in identity belongs to, and the one chosen on this browser, kept
 * per sign-in (`perch.session.memberships.<sign-in>`, `perch.session.tenant.<sign-in>`): a tab
 * hears another tab's writes late, so one that still shows a sign-in another tab ended may write
 * its list after the next sign-in, of another account or of the same one again; under its own
 * sign-in's key that list overwrites nothing of the next one's, and the ending of the earlier
 * sign-in removes nothing of it.
 */

import { idSchemas } from '@workspace/ids'
import { type Membership, membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'
import type { SignInId, SignInOwner } from './sign-in'

const MEMBERSHIPS_KEY_PREFIX = 'perch.session.memberships.'

/** The organisation chosen on this browser during a sign-in: `perch.session.tenant.<sign-in>`. */
const TENANT_KEY_PREFIX = 'perch.session.tenant.'

/** The key of the memberships kept for sign-in `signIn`; the tabs follow them. */
export function membershipsKeyOf(signIn: SignInId): string {
  return `${MEMBERSHIPS_KEY_PREFIX}${signIn}`
}

/** Whether `key` is the key of a sign-in's memberships. */
export function isMembershipsKey(key: string): boolean {
  return key.startsWith(MEMBERSHIPS_KEY_PREFIX)
}

const tenantKeyOf = (signIn: SignInId): string => `${TENANT_KEY_PREFIX}${signIn}`

const savedMembershipsSchema = z.object({
  identity: idSchemas.identity.schema,
  memberships: z.array(membership),
})

/** Keeps the organisations the identity of `owner` belongs to, as the gateway last told this device. */
export function saveMemberships(
  storage: KeyValueStorage,
  owner: SignInOwner,
  memberships: readonly Membership[],
): void {
  storage.set(
    membershipsKeyOf(owner.signIn),
    JSON.stringify({ identity: owner.identity, memberships }),
  )
}

/**
 * The memberships kept for the sign-in of `owner`; none when they were kept for another identity
 * or do not parse.
 */
export function savedMemberships(
  storage: KeyValueStorage,
  owner: SignInOwner,
): readonly Membership[] {
  const text = storage.get(membershipsKeyOf(owner.signIn))

  if (text === undefined) {
    return []
  }

  try {
    const parsed = savedMembershipsSchema.safeParse(JSON.parse(text))

    return parsed.success && parsed.data.identity === owner.identity ? parsed.data.memberships : []
  } catch {
    return []
  }
}

/** Keeps the key of the organisation chosen on this browser during sign-in `signIn`. */
export function saveTenant(storage: KeyValueStorage, signIn: SignInId, key: string): void {
  storage.set(tenantKeyOf(signIn), key)
}

/** The key of the organisation chosen during sign-in `signIn`, if one is kept. */
export function savedTenant(storage: KeyValueStorage, signIn: SignInId): string | undefined {
  return storage.get(tenantKeyOf(signIn))
}

/** Forgets the memberships and the organisation chosen of sign-in `signIn`; other sign-ins' stay. */
export function forgetMemberships(storage: KeyValueStorage, signIn: SignInId): void {
  storage.remove(membershipsKeyOf(signIn))
  storage.remove(tenantKeyOf(signIn))
}
