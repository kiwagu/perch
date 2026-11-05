import type { DataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { RegionDoc } from '../region-doc'

import type { OutboxDrainPort } from './outbox-drain'
import type { RegionSync } from './region-sync'

/** A region document and the sync that keeps it in step with the gateway. */
export interface SyncedRegion {
  readonly region: RegionDoc
  readonly sync: RegionSync
}

export interface EngineSettlingOptions {
  readonly regions: ReadonlyMap<string, SyncedRegion>
  /** Times how long `settled` waits. */
  readonly clock: Clock
  readonly drain: OutboxDrainPort
  readonly onError: (error: DataError) => void
  /** The channel is up, no pass runs and no probe waits for its heads. */
  readonly ready: () => boolean
}

/**
 * Tells when an engine has settled: the channel is up, every region has its first answer on this
 * connection, the outboxes are empty and every local update is durable, nothing waits for an answer
 * and no message is being handled; and when one region has caught up with the gateway. Whatever
 * such a check reads calls `changed`, so a waiting `settled` or `caughtUp` checks again.
 */
export class EngineSettling {
  readonly #regions: ReadonlyMap<string, SyncedRegion>
  readonly #clock: Clock
  readonly #drain: OutboxDrainPort
  readonly #onError: (error: DataError) => void
  readonly #ready: () => boolean
  /** Each wait under way: checks again on a change, and leaves the set once it ends. */
  readonly #watchers = new Set<() => void>()
  /** Server messages handed to a region and not yet handled. */
  #handling = 0
  /** Regions whose last flush failed, reported once until a flush succeeds again. */
  readonly #failingFlush = new Set<string>()

  constructor(options: EngineSettlingOptions) {
    this.#regions = options.regions
    this.#clock = options.clock
    this.#drain = options.drain
    this.#onError = options.onError
    this.#ready = options.ready
  }

  /** Something a check reads changed: a waiting `settled` or `caughtUp` checks again. */
  changed(): void {
    for (const watch of [...this.#watchers]) {
      watch()
    }
  }

  /** How many waits are under way: each ends resolved or rejected, and stops watching then. */
  watching(): number {
    return this.#watchers.size
  }

  /** Counts a server message handed to a region until it is handled. */
  track(handled: Promise<void>): void {
    this.#handling += 1
    void handled.finally(() => {
      this.#handling -= 1
      this.changed()
    })
  }

  /** Resolves once the engine has settled; rejects after `timeoutMs` on the clock. */
  settled(timeoutMs: number): Promise<void> {
    return this.#until(() => this.#isSettled(), timeoutMs, 'the sync did not settle')
  }

  /**
   * Resolves once region `id` has caught up with the gateway on the current connection, whichever
   * sync holds it by then (`RegionSync.caughtUp`); rejects after `timeoutMs` on the clock, which is
   * all it does for a region that stopped, one the welcome left out, or one the engine does not hold.
   */
  caughtUp(id: string, timeoutMs: number): Promise<void> {
    return this.#until(
      () => Promise.resolve(this.#regions.get(id)?.sync.caughtUp() === true),
      timeoutMs,
      `${id} did not catch up with the gateway`,
    )
  }

  /**
   * Resolves once `check` holds, checking again on every change, also one that came while it
   * checked; rejects after `timeoutMs` on the clock. Either way it stops watching.
   */
  #until(check: () => Promise<boolean>, timeoutMs: number, failure: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let checking = false
      let changedMeanwhile = false
      const watch = (): void => {
        if (checking) {
          changedMeanwhile = true

          return
        }

        checking = true
        changedMeanwhile = false
        void check().then(
          (holds) => {
            checking = false

            // A wait that timed out meanwhile has ended.
            if (!this.#watchers.has(watch)) {
              return
            }

            if (holds) {
              end()
              resolve()
            } else if (changedMeanwhile) {
              watch()
            }
          },
          (error: unknown) => {
            end()
            reject(error)
          },
        )
      }
      const cancel = this.#clock.schedule(timeoutMs, () => {
        end()
        reject(new Error(`${failure} within ${timeoutMs} ms`))
      })
      const end = (): void => {
        this.#watchers.delete(watch)
        cancel()
      }

      this.#watchers.add(watch)
      watch()
    })
  }

  /**
   * Whether a region that does not sync (it stopped, or the welcome did not name it) still holds
   * what it has not sent.
   */
  async stoppedWithUnsent(): Promise<boolean> {
    const stopped = [...this.#regions.values()].filter(({ sync }) => !sync.syncing())
    const unsent = await Promise.all(stopped.map(({ region }) => this.#holdsUnsent(region)))

    return unsent.some(Boolean)
  }

  async #isSettled(): Promise<boolean> {
    await this.#drain.idle()

    const syncing = [...this.#regions.values()].filter(({ sync }) => sync.syncing())
    const unsent = await Promise.all(syncing.map(({ region }) => this.#holdsUnsent(region)))

    return (
      this.#ready() &&
      this.#handling === 0 &&
      !unsent.some(Boolean) &&
      [...this.#regions.values()].every(({ sync }) => sync.quiet())
    )
  }

  /**
   * Whether the region holds local updates the gateway has not acknowledged: outbox rows, or
   * an update whose append failed and so lives in memory only, which the outbox does not show
   * (reported once, until a flush succeeds again). An outbox that cannot be read counts.
   */
  #holdsUnsent(region: RegionDoc): Promise<boolean> {
    const id = region.ref.id

    return region
      .flush()
      .andTee(() => this.#failingFlush.delete(id))
      .orTee((error) => {
        if (!this.#failingFlush.has(id)) {
          this.#failingFlush.add(id)
          this.#onError(error)
        }
      })
      .andThen(() => region.outbox(1))
      .match(
        (rows) => rows.length > 0,
        () => true,
      )
  }
}
