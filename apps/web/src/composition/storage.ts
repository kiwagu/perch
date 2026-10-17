import type { AuthUser } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'
import { membership } from '@workspace/replica/protocol'
import type { DeviceCredentials } from '@workspace/replica/sync'
import { z } from '@workspace/zod'

import type { SessionNotice } from '../platform/session.port'

import type { SignedInDevice } from './gateway-auth'

/** Small persistent key-value storage, shared by the tabs of one browser. */
export interface KeyValueStorage {
  get(key: string): string | undefined
  set(key: string, value: string): void
  remove(key: string): void
  /**
   * Hears a key that another tab of this browser set or removed, `undefined` when it cleared
   * every key; this tab's own changes are not told.
   */
  onChangeElsewhere(listener: (key: string | undefined) => void): () => void
}

export interface MemoryStorage extends KeyValueStorage {
  /** Sets a key, or removes it with `undefined`, as another tab would: the listeners hear it. */
  changeElsewhere(key: string, value: string | undefined): void
}

export function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  const listeners = new Set<(key: string | undefined) => void>()

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value)
    },
    remove: (key) => {
      values.delete(key)
    },
    onChangeElsewhere: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    changeElsewhere: (key, value) => {
      if (value === undefined) {
        values.delete(key)
      } else {
        values.set(key, value)
      }

      for (const listener of listeners) {
        listener(key)
      }
    },
  }
}

/** The part of `window` that tells a tab about storage changes made in the others. */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void
}

/** The browser's localStorage; when it is unavailable (private mode, blocked), nothing is kept. */
export function browserStorage(store: Storage, events: StorageEvents): KeyValueStorage {
  const attempt = <T>(run: () => T, fallback: T): T => {
    try {
      return run()
    } catch {
      return fallback
    }
  }

  return {
    get: (key) => attempt(() => store.getItem(key) ?? undefined, undefined),
    set: (key, value) => attempt(() => store.setItem(key, value), undefined),
    remove: (key) => attempt(() => store.removeItem(key), undefined),
    onChangeElsewhere: (listener) => {
      const handler = (event: StorageEvent) => {
        if (event.storageArea === store) {
          listener(event.key ?? undefined)
        }
      }

      events.addEventListener('storage', handler)

      return () => events.removeEventListener('storage', handler)
    },
  }
}

const DEVICE_KEY = 'perch.device.id'

/** This browser's stable name, minted on first use; commands carry it in their context. */
export function deviceIdFrom(storage: KeyValueStorage): string {
  const saved = storage.get(DEVICE_KEY)

  if (saved) {
    return saved
  }

  const minted = crypto.randomUUID()

  storage.set(DEVICE_KEY, minted)

  return minted
}

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

/** The organisations the signed-in identity belongs to; the tabs follow them. */
export const MEMBERSHIPS_KEY = 'perch.session.memberships'

const TENANT_KEY = 'perch.session.tenant'

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

/**
 * The organisation databases this device may hold for an identity, by key: every one the space
 * opened or was about to open, until it is deleted. It outlives the keys (a sign-out that keeps
 * the databases for the next sign-in keeps it too), so a database whose membership went while
 * nobody was signed in is still found and deleted.
 */
export const TENANT_DATABASES_KEY = 'perch.session.tenant-databases'

const savedTenantDatabasesSchema = z.object({
  identity: idSchemas.identity.schema,
  // A key names a database to delete: only an organisation's key is taken.
  keys: z.array(z.string().refine(isTenantKey)),
})

/** Keeps the keys of the organisation databases `identity` has on this device; none keeps nothing. */
export function saveTenantDatabases(
  storage: KeyValueStorage,
  identity: IdentityId,
  keys: readonly string[],
): void {
  if (keys.length === 0) {
    storage.remove(TENANT_DATABASES_KEY)
  } else {
    storage.set(TENANT_DATABASES_KEY, JSON.stringify({ identity, keys }))
  }
}

/** The keys kept for `identity`; none when they were kept for another or do not parse. */
export function savedTenantDatabases(
  storage: KeyValueStorage,
  identity: IdentityId,
): readonly string[] {
  const text = storage.get(TENANT_DATABASES_KEY)

  if (text === undefined) {
    return []
  }

  try {
    const parsed = savedTenantDatabasesSchema.safeParse(JSON.parse(text))

    return parsed.success && parsed.data.identity === identity ? parsed.data.keys : []
  } catch {
    return []
  }
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

const NOTICE_KEY = 'perch.session.notice'

const sessionNotice = z.enum(['resend-after-sign-in'])

/** Leaves the sign-in page a word about how the last session ended. */
export function saveNotice(storage: KeyValueStorage, notice: SessionNotice): void {
  storage.set(NOTICE_KEY, notice)
}

/** The word the last session left for the sign-in page; a kept value it does not know is none. */
export function savedNotice(storage: KeyValueStorage): SessionNotice | undefined {
  const parsed = sessionNotice.safeParse(storage.get(NOTICE_KEY))

  return parsed.success ? parsed.data : undefined
}

export function forgetNotice(storage: KeyValueStorage): void {
  storage.remove(NOTICE_KEY)
}

const SIGNING_OUT_KEY = 'perch.session.signing-out'

/** Tells every tab, those opened later included, that a sign-out began at `at` (epoch milliseconds). */
export function saveSigningOut(storage: KeyValueStorage, at: number): void {
  storage.set(SIGNING_OUT_KEY, String(at))
}

/** When the sign-out under way in this browser began; a kept value that is not a time is none. */
export function signingOutSince(storage: KeyValueStorage): number | undefined {
  const at = Number(storage.get(SIGNING_OUT_KEY) ?? Number.NaN)

  return Number.isFinite(at) ? at : undefined
}

export function forgetSigningOut(storage: KeyValueStorage): void {
  storage.remove(SIGNING_OUT_KEY)
}

/**
 * Forgets who is signed in and the keys; the other tabs hear the identity go. The inventory of
 * the organisation databases stays: the databases may stay too.
 */
export function forgetDevice(storage: KeyValueStorage): void {
  storage.remove(ACCESS_KEY)
  storage.remove(REFRESH_KEY)
  storage.remove(IDENTITY_KEY)
  storage.remove(MEMBERSHIPS_KEY)
  storage.remove(TENANT_KEY)
}
