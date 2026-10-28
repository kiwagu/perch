/**
 * The identities whose local databases this device still has to delete: a sign-out records the
 * identity before it deletes them and forgets it once they are gone. A delete another tab held
 * up past the sign-out, or one the page closed before it ran, leaves the identity listed, and
 * the next start of the app deletes its databases.
 */

import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from '../storage'

export const LEFTOVER_IDENTITIES_KEY = 'perch.session.leftover-identities'

/** The identities listed, oldest first; an entry that is not an identity is skipped. */
export function leftoverIdentities(storage: KeyValueStorage): readonly IdentityId[] {
  const text = storage.get(LEFTOVER_IDENTITIES_KEY)

  if (text === undefined) {
    return []
  }

  try {
    const entries = z.array(z.unknown()).safeParse(JSON.parse(text))

    return entries.success
      ? entries.data.flatMap((entry) => {
          const parsed = idSchemas.identity.schema.safeParse(entry)

          return parsed.success ? [parsed.data] : []
        })
      : []
  } catch {
    return []
  }
}

function saveLeftoverIdentities(storage: KeyValueStorage, identities: readonly IdentityId[]) {
  if (identities.length === 0) {
    storage.remove(LEFTOVER_IDENTITIES_KEY)
  } else {
    storage.set(LEFTOVER_IDENTITIES_KEY, JSON.stringify(identities))
  }
}

/** Lists `identity` after those listed before, unless it is listed already. */
export function addLeftoverIdentity(storage: KeyValueStorage, identity: IdentityId): void {
  const listed = leftoverIdentities(storage)

  if (!listed.includes(identity)) {
    saveLeftoverIdentities(storage, [...listed, identity])
  }
}

/** Takes `identity` off the list; the others stay, those another tab listed included. */
export function dropLeftoverIdentity(storage: KeyValueStorage, identity: IdentityId): void {
  saveLeftoverIdentities(
    storage,
    leftoverIdentities(storage).filter((each) => each !== identity),
  )
}
