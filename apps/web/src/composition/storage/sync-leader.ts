/**
 * The record the tab that leads this browser's sync shares with the other tabs, a fact of the
 * browser rather than of an account: whether its channel is up, whether changes made on this
 * device wait to be sent, whether the sync stopped for good, and when it last said so. Only the
 * leading tab writes it; every tab reads it (`composition/sync-status.ts`).
 */

import { z } from '@workspace/zod'

import type { KeyValueStorage } from './key-value'

export const SYNC_LEADER_KEY = 'perch.sync.leader'

const leaderSchema = z.object({
  channel: z.enum(['up', 'down']),
  // Whether changes wait to be sent; null until a read of the outbox answered, or after one failed.
  waiting: z.boolean().nullable(),
  stopped: z.boolean(),
  at: z.number(),
})

/** What the leading tab last said of its sync. */
export type SyncLeader = z.output<typeof leaderSchema>

/** The record of the leading tab; none without one, or from one this code did not write. */
export function savedSyncLeader(storage: KeyValueStorage): SyncLeader | undefined {
  const text = storage.get(SYNC_LEADER_KEY)

  if (text === undefined) {
    return undefined
  }

  try {
    const read = leaderSchema.safeParse(JSON.parse(text))

    return read.success ? read.data : undefined
  } catch {
    // Not a record this code wrote: there is no leader to read.
    return undefined
  }
}

/** Keeps what the leading tab says of its sync now, in place of what it said before. */
export function saveSyncLeader(storage: KeyValueStorage, leader: SyncLeader): void {
  storage.set(SYNC_LEADER_KEY, JSON.stringify(leader))
}

/** Forgets the leading tab's record: it stopped leading, and the next leader writes its own. */
export function forgetSyncLeader(storage: KeyValueStorage): void {
  storage.remove(SYNC_LEADER_KEY)
}
