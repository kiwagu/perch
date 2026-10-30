import type { LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'

import resetStatement from '../surql/replica-reset.surql'

/**
 * A device database whose region resets go through `before` first: it may throw, so the reset
 * fails as on a broken database (a region whose batch is refused again then stops with its
 * rows), or wait, so the reset is held. Every other query reaches the database unchanged.
 */
export function interceptRegionResets(local: LocalDb, before: () => void | Promise<void>): LocalDb {
  return interceptQueries(local, (text) => (text === resetStatement ? before() : undefined))
}
