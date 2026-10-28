/** Who is signed in on this browser, and the keys the device presents to the gateway. */

import type { AuthUser } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import type { DeviceCredentials } from '@workspace/replica/sync'
import { z } from '@workspace/zod'

import type { SignedInDevice } from '../gateway-auth'

import type { KeyValueStorage } from './key-value'
import { MEMBERSHIPS_KEY, saveMemberships, TENANT_KEY } from './memberships'

/** Who is signed in on this browser; the tabs follow it. */
export const IDENTITY_KEY = 'perch.session.identity'

/** The access token the gateway issued the device last; renewing the keys changes it. */
export const ACCESS_KEY = 'perch.session.token'

const REFRESH_KEY = 'perch.session.refresh'

const savedIdentitySchema = z.object({ id: idSchemas.identity.schema, email: z.string() })

/** Keeps the identity signed in on this browser and its keys at the gateway. */
export function saveDevice(storage: KeyValueStorage, device: SignedInDevice): void {
  saveKeys(storage, device.tokens)
  storage.set(
    IDENTITY_KEY,
    JSON.stringify({ id: device.identity.id, email: device.identity.email }),
  )
  saveMemberships(storage, device.identity.id, device.memberships)
}

/** Keeps a renewed pair of keys: a refresh key works once, so the next connection needs the latest. */
export function saveKeys(storage: KeyValueStorage, tokens: SignedInDevice['tokens']): void {
  storage.set(ACCESS_KEY, tokens.access)
  storage.set(REFRESH_KEY, tokens.refresh)
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

/** The keys the device presents to the gateway, if it keeps a pair. */
export function savedKeys(storage: KeyValueStorage): DeviceCredentials | undefined {
  const access = storage.get(ACCESS_KEY)
  const refresh = storage.get(REFRESH_KEY)

  return access === undefined
    ? undefined
    : { access, ...(refresh === undefined ? {} : { refresh }) }
}

/**
 * Forgets who is signed in and the keys; the other tabs hear the identity go. The inventory of
 * the organisation databases stays: the databases may stay too. So do the pairs left to revoke.
 */
export function forgetDevice(storage: KeyValueStorage): void {
  storage.remove(ACCESS_KEY)
  storage.remove(REFRESH_KEY)
  storage.remove(IDENTITY_KEY)
  storage.remove(MEMBERSHIPS_KEY)
  storage.remove(TENANT_KEY)
}
