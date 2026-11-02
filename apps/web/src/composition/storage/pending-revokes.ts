import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'

/**
 * The session tokens of the sign-outs the gateway did not confirm (offline, or giving unsent
 * changes up), each with the device it signs out: their sessions still live at the gateway until
 * each is sent to be signed out. One list for every account signed out on this browser, oldest
 * first; it outlives the token kept for the signed-in device.
 */
const PENDING_REVOKE_KEY = 'perch.session.pending-revoke'

/** How many tokens wait at most: one more drops the oldest. */
export const PENDING_REVOKE_LIMIT = 8

const pendingToken = z.object({ token: z.string().min(1), device: deviceId })

/** A session token left to sign out, and the device its sign-out named. */
export type PendingToken = z.infer<typeof pendingToken>

/**
 * The tokens left to sign out, oldest first. An entry that does not describe one is skipped, the
 * key pairs an older build kept among them: the gateway no longer knows them.
 */
export function pendingRevokes(storage: KeyValueStorage): readonly PendingToken[] {
  const text = storage.get(PENDING_REVOKE_KEY)

  if (text === undefined) {
    return []
  }

  try {
    const entries = z.array(z.unknown()).safeParse(JSON.parse(text) as unknown)

    return entries.success
      ? entries.data.flatMap((entry) => {
          const parsed = pendingToken.safeParse(entry)

          return parsed.success ? [parsed.data] : []
        })
      : []
  } catch {
    return []
  }
}

function savePendingRevokes(storage: KeyValueStorage, tokens: readonly PendingToken[]): void {
  if (tokens.length === 0) {
    storage.remove(PENDING_REVOKE_KEY)
  } else {
    storage.set(PENDING_REVOKE_KEY, JSON.stringify(tokens))
  }
}

/**
 * Keeps a token to sign out after those kept before (a token kept already stays where it is),
 * read and written at once so a token another tab kept meanwhile stays too. Answers the oldest
 * tokens it dropped to keep at most `PENDING_REVOKE_LIMIT`.
 */
export function addPendingRevoke(
  storage: KeyValueStorage,
  left: PendingToken,
): readonly PendingToken[] {
  const kept = pendingRevokes(storage)

  if (kept.some((each) => each.token === left.token)) {
    return []
  }

  const next = [...kept, left]
  const dropped = next.slice(0, Math.max(0, next.length - PENDING_REVOKE_LIMIT))

  savePendingRevokes(storage, next.slice(dropped.length))

  return dropped
}

/** Forgets the entry of `token`; the others stay, those another tab kept included. */
export function forgetPendingRevoke(storage: KeyValueStorage, token: string): void {
  savePendingRevokes(
    storage,
    pendingRevokes(storage).filter((left) => left.token !== token),
  )
}
