import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'

import { RegionDoc } from './region-doc'
import { RegionStore } from './region-store'

/** How a region's document is replaced: see `replaceRegionDoc`. */
export type RegionReplacement = 'reset' | 'reopen'

/**
 * The document that takes `current`'s place. `reset` drops the region's local copy, every change
 * not sent yet included, and opens it empty: syncing it loads it from the server. `reopen` opens
 * it again from the database, after another document of the region reset it. `current` is
 * flushed first and closed once its successor is open; a reset the database refuses changes
 * nothing, and `current` stays open.
 */
export function replaceRegionDoc(
  local: LocalDb,
  current: RegionDoc,
  how: RegionReplacement,
): ResultAsync<RegionDoc, DataError> {
  const dropped =
    how === 'reset'
      ? () => RegionStore.reset(local, current.ref.id).map(() => undefined)
      : () => okAsync(undefined)

  return (
    current
      .flush()
      // A write that did not become durable was reported to whoever made it; a stale document
      // cannot flush at all. Either way the replacement goes on.
      .orElse(() => okAsync(undefined))
      .andThen(dropped)
      .andThen(() => RegionDoc.open(local, current.ref))
      .andTee(() => current.close())
  )
}
