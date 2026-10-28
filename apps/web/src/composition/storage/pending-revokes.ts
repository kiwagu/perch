import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { deviceIdFrom } from './device'
import type { KeyValueStorage } from './key-value'

/**
 * The pairs of the sign-outs the gateway did not confirm (offline, or giving unsent changes up),
 * each with the device it signs out: their grants still live at the gateway until each is sent to
 * be revoked. One list for every account signed out on this browser, oldest first; it outlives
 * the keys.
 */
const PENDING_REVOKE_KEY = 'perch.session.pending-revoke'

/** How many pairs wait at most: one more drops the oldest. */
export const PENDING_REVOKE_LIMIT = 8

const keyPair = z.object({ access: z.string().min(1), refresh: z.string().min(1) })

const pendingPair = keyPair.extend({ device: deviceId })

/** A pair left to revoke, and the device its sign-out named. */
export type PendingPair = z.infer<typeof pendingPair>

/**
 * The pairs left to revoke, oldest first. An entry that does not describe one is skipped; a
 * single pair kept on its own, as before the list, is read as a list of one from this device.
 */
export function pendingRevokes(storage: KeyValueStorage): readonly PendingPair[] {
  const text = storage.get(PENDING_REVOKE_KEY)

  if (text === undefined) {
    return []
  }

  try {
    const value = JSON.parse(text) as unknown
    const entries = z.array(z.unknown()).safeParse(value)

    if (entries.success) {
      return entries.data.flatMap((entry) => {
        const parsed = pendingPair.safeParse(entry)

        return parsed.success ? [parsed.data] : []
      })
    }

    const alone = keyPair.safeParse(value)

    return alone.success ? [{ ...alone.data, device: deviceIdFrom(storage) }] : []
  } catch {
    return []
  }
}

function savePendingRevokes(storage: KeyValueStorage, pairs: readonly PendingPair[]): void {
  if (pairs.length === 0) {
    storage.remove(PENDING_REVOKE_KEY)
  } else {
    storage.set(PENDING_REVOKE_KEY, JSON.stringify(pairs))
  }
}

/**
 * Keeps a pair to revoke after those kept before (a pair kept already stays where it is), read
 * and written at once so a pair another tab kept meanwhile stays too. Answers the oldest pairs it
 * dropped to keep at most `PENDING_REVOKE_LIMIT`.
 */
export function addPendingRevoke(
  storage: KeyValueStorage,
  pair: PendingPair,
): readonly PendingPair[] {
  const kept = pendingRevokes(storage)

  if (kept.some((each) => each.refresh === pair.refresh)) {
    return []
  }

  const next = [...kept, pair]
  const dropped = next.slice(0, Math.max(0, next.length - PENDING_REVOKE_LIMIT))

  savePendingRevokes(storage, next.slice(dropped.length))

  return dropped
}

/** Forgets the pair whose refresh key is `refresh`; the others stay, those another tab kept included. */
export function forgetPendingRevoke(storage: KeyValueStorage, refresh: string): void {
  savePendingRevokes(
    storage,
    pendingRevokes(storage).filter((pair) => pair.refresh !== refresh),
  )
}
