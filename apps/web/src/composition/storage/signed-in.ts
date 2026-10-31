/** Who is signed in on this browser, and the session token the device presents to the gateway. */

import type { AuthUser } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { SignedInDevice } from '../gateway-auth'

import type { KeyValueStorage } from './key-value'
import { MEMBERSHIPS_KEY, saveMemberships, TENANT_KEY } from './memberships'

/** Who is signed in on this browser; the tabs follow it. */
export const IDENTITY_KEY = 'perch.session.identity'

/** The session token the gateway issued the device at its sign-in; it lives until a sign-out. */
export const TOKEN_KEY = 'perch.session.token'

/** The refresh key an older build kept beside its access token; nothing reads or writes it now. */
const OLD_REFRESH_KEY = 'perch.session.refresh'

const savedIdentitySchema = z.object({ id: idSchemas.identity.schema, email: z.string() })

/** A device whose sign-in is whole: who it is, its session token and the memberships it read. */
export interface KeptDevice extends SignedInDevice {
  readonly memberships: readonly Membership[]
}

/**
 * Keeps the device a sign-in made whole, in one step: the memberships and the token first, the
 * identity last, so a tab that follows the identity finds the rest saved already.
 */
export function saveDevice(storage: KeyValueStorage, device: KeptDevice): void {
  saveMemberships(storage, device.identity.id, device.memberships)
  storage.set(TOKEN_KEY, device.token)
  storage.set(
    IDENTITY_KEY,
    JSON.stringify({ id: device.identity.id, email: device.identity.email }),
  )
}

/** The identity signed in on this browser; a kept value that does not describe one is none. */
export function savedIdentity(storage: KeyValueStorage): AuthUser | undefined {
  const text = storage.get(IDENTITY_KEY)

  if (text === undefined) {
    return undefined
  }

  try {
    const parsed = savedIdentitySchema.safeParse(JSON.parse(text))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** The session token the device presents to the gateway, if it keeps one. */
export function savedToken(storage: KeyValueStorage): string | undefined {
  return storage.get(TOKEN_KEY)
}

/**
 * Forgets who is signed in and the token; the other tabs hear the identity go. The inventory of
 * the organisation databases stays: the databases may stay too. So do the tokens left to sign
 * out. A refresh key an older build kept goes too.
 */
export function forgetDevice(storage: KeyValueStorage): void {
  storage.remove(TOKEN_KEY)
  storage.remove(OLD_REFRESH_KEY)
  storage.remove(IDENTITY_KEY)
  storage.remove(MEMBERSHIPS_KEY)
  storage.remove(TENANT_KEY)
}
