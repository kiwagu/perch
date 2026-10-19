/**
 * Replaces the region documents of an identity's space: for the sync engine, which reloads a
 * region from the server, and when another tab of the browser reset a region.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { RegionDoc, RegionReplacement } from '@workspace/replica'
import type { SyncHints } from '@workspace/replica/sync'

import type { RegionSpace } from './region-space'

export interface RegionReloadsOptions {
  /** The region spaces open now. */
  readonly spaces: () => readonly RegionSpace[]
  readonly hints: SyncHints
  readonly onError: (error: DataError) => void
}

/** Replaces the region documents of an identity's space: for the sync engine, and when another tab reset a region. */
export class RegionReloads {
  constructor(private readonly options: RegionReloadsOptions) {}

  /**
   * The document that takes `region`'s place, from the space that holds the region (by id); after
   * a reset the other tabs are told (`reset` hint). A region no open space holds fails `data:OPEN_FAILED`.
   */
  replace(region: RegionDoc, how: RegionReplacement): ResultAsync<RegionDoc, DataError> {
    const space = this.options.spaces().find((open) => open.region.ref.id === region.ref.id)

    if (!space) {
      return errAsync(
        dataError('data:OPEN_FAILED', `no open space holds ${region.ref.id} to replace it`),
      )
    }

    return space.replace(region, how).andTee(() => {
      if (how === 'reset') {
        this.options.hints.post('reset')
      }
    })
  }

  /** Reopens every region another tab reset; reports what fails, never rejects. */
  async reloadStale(): Promise<void> {
    await Promise.all(
      this.options.spaces().map((space) => {
        const current = space.region

        return space
          .stale()
          .andThen((stale) => (stale ? space.replace(current, 'reopen') : okAsync(current)))
          .match(
            () => undefined,
            (error) => this.options.onError(error),
          )
      }),
    )
  }
}
