import { type IdentityId, idSchemas } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'

/**
 * The organisation databases this device may hold for each identity, by key: every one the
 * identity's space opened or was about to open, until it is deleted. It outlives the keys (a
 * sign-out that keeps the databases for the next sign-in keeps it too), so a database whose
 * membership went while nobody was signed in is still found and deleted. Each identity's keys
 * are kept apart (`{ [identity]: keys }`): another identity signing in on this browser leaves
 * them as they are.
 */
export const TENANT_DATABASES_KEY = 'perch.session.tenant-databases'

const savedTenantDatabasesSchema = z.record(
  idSchemas.identity.schema,
  // A key names a database to delete: only an organisation's key is taken.
  z.array(z.string().refine(isTenantKey)),
)

/** The keys kept for every identity; none when the kept value does not parse. */
function savedTenantDatabasesOfAll(
  storage: KeyValueStorage,
): Partial<Record<IdentityId, readonly string[]>> {
  const text = storage.get(TENANT_DATABASES_KEY)

  if (text === undefined) {
    return {}
  }

  try {
    const parsed = savedTenantDatabasesSchema.safeParse(JSON.parse(text))

    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/**
 * Keeps the keys of the organisation databases `identity` has on this device, in place of those
 * kept for it before; the other identities' stay. None keeps nothing for it, and the storage
 * keeps no empty inventory.
 */
export function saveTenantDatabases(
  storage: KeyValueStorage,
  identity: IdentityId,
  keys: readonly string[],
): void {
  const others = Object.entries(savedTenantDatabasesOfAll(storage)).filter(
    ([each]) => each !== identity,
  )
  const next = keys.length === 0 ? others : [...others, [identity, keys] as const]

  if (next.length === 0) {
    storage.remove(TENANT_DATABASES_KEY)
  } else {
    storage.set(TENANT_DATABASES_KEY, JSON.stringify(Object.fromEntries(next)))
  }
}

/** The keys kept for `identity`; none when none were kept for it or the kept value does not parse. */
export function savedTenantDatabases(
  storage: KeyValueStorage,
  identity: IdentityId,
): readonly string[] {
  return savedTenantDatabasesOfAll(storage)[identity] ?? []
}
