import type { LoroDoc } from 'loro-crdt'
import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { RegionRef } from '../region-doc'

import type { RegionDatabase, RegionDatabases } from './region-databases'
import { RegionLog } from './region-log'
import {
  type Actor,
  deliver,
  notSubscribed,
  type Subscriber,
  type Subscription,
} from './subscription'

/** A region's log and its authoritative document, and the hold on the database that keeps them. */
export interface Loaded {
  readonly log: RegionLog
  readonly doc: LoroDoc
  readonly database: RegionDatabase
}

/** What the hub keeps of one region, from the first subscription until it unloads the region. */
export interface RegionState {
  readonly ref: RegionRef
  /** Devices whose subscription was answered: each receives the batches the others push. */
  readonly subscribers: Map<string, Subscription>
  /** Devices whose subscription waits in the queue for its answer. */
  readonly joining: Map<string, Subscription>
  /** Settles once the work asked of the region so far has; the next work waits for it. */
  queue: Promise<void>
  /** The region's log and document, once the first subscription has loaded them. */
  loaded: Loaded | undefined
  /** Cancels the unload scheduled when the last device left. */
  unload: (() => void) | undefined
}

export interface HeldRegionsOptions {
  /** Where each region's log and projection live: held while the region is loaded. */
  readonly databases: RegionDatabases
  readonly clock: Clock
  /** How long a region nobody subscribes to stays in memory. */
  readonly idleUnloadMs: number
  readonly onError: (error: DataError) => void
}

/**
 * The regions a hub holds, by id: each from its first subscription, with its subscribers, its queue
 * of work (one piece at a time, in the order asked) and, once loaded, its log and document from its
 * own database, held until the region unloads. A region nobody subscribes to any more unloads after
 * an idle time, and its database is released.
 */
export class HeldRegions {
  readonly #regions = new Map<string, RegionState>()
  readonly #databases: RegionDatabases
  readonly #clock: Clock
  readonly #idleUnloadMs: number
  readonly #onError: (error: DataError) => void

  constructor(options: HeldRegionsOptions) {
    this.#databases = options.databases
    this.#clock = options.clock
    this.#idleUnloadMs = options.idleUnloadMs
    this.#onError = options.onError
  }

  /** The region held under `regionId`, if any. */
  get(regionId: string): RegionState | undefined {
    return this.#regions.get(regionId)
  }

  /** Holds a region not held yet: nobody subscribed, nothing loaded. */
  hold(ref: RegionRef): RegionState {
    const state: RegionState = {
      ref,
      subscribers: new Map(),
      joining: new Map(),
      queue: Promise.resolve(),
      loaded: undefined,
      unload: undefined,
    }

    this.#regions.set(ref.id, state)

    return state
  }

  /** Loads the region from its database, which stays held until the region unloads. */
  load(state: RegionState): ResultAsync<Loaded, DataError> {
    if (state.loaded) {
      return okAsync(state.loaded)
    }

    return this.#databases.acquire(state.ref).andThen((database) =>
      RegionLog.load(database.local, state.ref.id)
        .map(({ log, doc }) => {
          const loaded = { log, doc, database }

          state.loaded = loaded

          return loaded
        })
        .orElse((error) => {
          database.release()

          return errAsync(error)
        }),
    )
  }

  /**
   * Runs `work` on the region once the device has subscribed to it, with the actor its
   * subscription named (identity id and ability); any other device is refused.
   */
  subscribed(
    regionId: string,
    subscriber: Subscriber,
    work: (state: RegionState, loaded: Loaded, actor: Actor) => ResultAsync<void, DataError>,
  ): ResultAsync<void, DataError> {
    const state = this.#regions.get(regionId)

    if (!state) {
      deliver(subscriber, notSubscribed(regionId), this.#onError)

      return okAsync(undefined)
    }

    return this.answer(state, subscriber, () => {
      const subscription = state.subscribers.get(subscriber.id)

      // A subscribed device's region is loaded: a region unloads only after its last device left.
      if (!state.loaded || !subscription) {
        deliver(subscriber, notSubscribed(regionId), this.#onError)

        return okAsync(undefined)
      }

      return work(state, state.loaded, subscription.actor)
    })
  }

  /**
   * Runs `work` in the region's queue. A failure is reported and answered to the device as an
   * internal error, so the work always settles as answered.
   */
  answer(
    state: RegionState,
    subscriber: Subscriber,
    work: () => ResultAsync<void, DataError>,
  ): ResultAsync<void, DataError> {
    const run = state.queue.then(() =>
      work().orElse((error) => {
        this.#onError(error)
        deliver(
          subscriber,
          { type: 'error', code: 'internal', message: error.message },
          this.#onError,
        )

        return ok(undefined)
      }),
    )

    // The next work waits for this one to settle, whatever its outcome.
    state.queue = run.then(
      () => undefined,
      () => undefined,
    )

    return new ResultAsync(run)
  }

  /**
   * Schedules the region's unload once no device subscribes to it. The unload runs in the
   * region's queue, after the work asked before it, and only if still nobody subscribes; it
   * releases the region's database.
   */
  unloadWhenIdle(state: RegionState): void {
    if (state.unload || state.subscribers.size > 0 || state.joining.size > 0) {
      return
    }

    state.unload = this.#clock.schedule(this.#idleUnloadMs, () => {
      state.unload = undefined
      state.queue = state.queue.then(() => {
        const idle = state.subscribers.size === 0 && state.joining.size === 0

        if (idle && this.#regions.get(state.ref.id) === state) {
          this.#regions.delete(state.ref.id)
          state.loaded?.database.release()
          state.loaded = undefined
        }
      })
    })
  }

  /** How many regions have their document in memory. */
  loadedRegions(): number {
    return [...this.#regions.values()].filter((state) => state.loaded).length
  }

  /**
   * Cancels the scheduled unloads, drops every region, waits for the work under way, then
   * releases the databases of the regions it held.
   */
  async close(): Promise<void> {
    const states = [...this.#regions.values()]

    this.#regions.clear()

    for (const state of states) {
      state.unload?.()
    }

    await Promise.all(states.map((state) => state.queue))

    for (const state of states) {
      state.loaded?.database.release()
    }
  }
}
