import type { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { RegionDoc } from '../region-doc'
import type { RegionReplacement } from '../region-replacement'

import type { SyncedRegion } from './engine-settling'
import type { PushOutcome } from './region-push'
import type { Refusal } from './region-rollback'
import { RegionSync } from './region-sync'
import type { SyncTransport } from './transport'

export interface EngineRegionsOptions {
  readonly regions: readonly RegionDoc[]
  readonly transport: SyncTransport
  readonly clock: Clock
  /** Who inverse commits of rejected batches are written as. */
  readonly actor: string
  /** Imported something from the server. */
  readonly onSettled: () => void
  readonly onError: (error: DataError) => void
  /** How many outbox rows one push of a region carries at most; the protocol's limit by default. */
  readonly batchRows?: number
  /** How many rows past its snapshot a region's local log holds before it is compacted. */
  readonly localCompactionRows?: number
  /** The document that takes a region's place; see `SyncEngineOptions.replaceRegion`. */
  readonly replaceRegion: (
    region: RegionDoc,
    how: RegionReplacement,
  ) => ResultAsync<RegionDoc, DataError>
  /** Counts a replacement until it ends, as `settled` waits for it. */
  readonly track: (replaced: Promise<void>) => void
  /** Asks the outbox drain to run: a replaced region may hold writes made meanwhile. */
  readonly drain: () => void
  /** Something a settled check reads changed. */
  readonly changed: () => void
}

/**
 * The regions an engine syncs, each with its `RegionSync`, by region id. A region whose batch the
 * gateway refused again after its rollback, or whose local copy another tab reset, gets a new
 * document from the app and a new sync over it, subscribed on the current connection.
 */
export class EngineRegions {
  readonly #options: EngineRegionsOptions
  readonly #map = new Map<string, SyncedRegion>()
  /** The regions being replaced. */
  readonly #replacing = new Set<string>()
  #stopped = false

  constructor(options: EngineRegionsOptions) {
    this.#options = options

    for (const region of options.regions) {
      this.#map.set(region.ref.id, { region, sync: this.#syncOf(region) })
    }
  }

  /** The region map the engine's settling and passes read; a replacement swaps an entry in it. */
  get map(): ReadonlyMap<string, SyncedRegion> {
    return this.#map
  }

  /** The next batch of the first region that has one. */
  async pushNext(): Promise<PushOutcome> {
    try {
      for (const { sync } of this.#map.values()) {
        const outcome = await sync.pushNext()

        if (outcome !== 'empty') {
          return outcome
        }
      }

      return 'empty'
    } finally {
      this.#options.changed()
    }
  }

  /**
   * Replaces region `id`'s document once at a time: retires its sync, asks `replaceRegion`, puts a
   * new sync over the answer in the map, subscribes it and asks the drain; tracked, so `settled`
   * waits for it. After a reset (`refusal`) it reports `data:REGION_RELOADED`; a replacement that
   * fails leaves the retired sync in place, so the region no longer syncs, and reports
   * `data:SYNC_STOPPED`. A request for a region being replaced, or after `stop`, does nothing.
   */
  replace(id: string, how: RegionReplacement, refusal?: Refusal): void {
    const current = this.#map.get(id)

    if (!current || this.#replacing.has(id) || this.#stopped) {
      return
    }

    this.#replacing.add(id)
    current.sync.retire()

    const replaced = this.#options.replaceRegion(current.region, how).match(
      (region) => {
        if (refusal) {
          this.#reloaded(id, refusal)
        }

        // A stopped engine syncs nothing more; the next one opens over the app's document.
        if (!this.#stopped) {
          const sync = this.#syncOf(region, true)

          this.#map.set(id, { region, sync })
          // On the current connection, as its welcome named the region or not.
          sync.welcome(current.sync.welcomed())
          this.#options.drain()
        }
      },
      (error) =>
        this.#options.onError(
          dataError(
            'data:SYNC_STOPPED',
            `could not replace the document of ${id} (${how}: ${error.message}); the region no longer syncs`,
            error,
          ),
        ),
    )

    this.#options.track(replaced.finally(() => this.#replacing.delete(id)))
  }

  /** No replacement is swapped in any more. */
  stop(): void {
    this.#stopped = true
  }

  #reloaded(id: string, { batch, reason, detail }: Refusal): void {
    this.#options.onError(
      dataError(
        'data:REGION_RELOADED',
        `the gateway rejected batch ${batch} of ${id} again after its rollback (${reason}: ${detail}); its local copy and every change not sent yet were dropped, and it is loaded again from the server`,
        { region: id, batch, reason, detail },
      ),
    )
  }

  /**
   * The sync of `region`, `replacing` the region's former one or not. A copy another tab reset is
   * opened again rather than reported; what a sync reports while its region is replaced, or once
   * it was, is not: its document is gone.
   */
  #syncOf(region: RegionDoc, replacing = false): RegionSync {
    const options = this.#options
    const id = region.ref.id
    const sync: RegionSync = new RegionSync({
      region,
      transport: options.transport,
      clock: options.clock,
      actor: options.actor,
      onSettled: options.onSettled,
      onError: (error) => {
        if (this.#map.get(id)?.sync !== sync || this.#replacing.has(id)) {
          return
        }

        if (error.code === 'data:REGION_STALE') {
          this.replace(id, 'reopen')
        } else {
          options.onError(error)
        }
      },
      onReset: (refusal) => this.replace(id, 'reset', refusal),
      replacing,
      ...(options.batchRows === undefined ? {} : { batchRows: options.batchRows }),
      ...(options.localCompactionRows === undefined
        ? {}
        : { localCompactionRows: options.localCompactionRows }),
    })

    return sync
  }
}
