import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { Clock } from '../../clock'
import type { RegionRef } from '../../region-doc'
import type { RegionDatabases } from '../region-databases'
import { RegionLog } from '../region-log'

import type { Loaded, RegionState } from './region-state'
import { type Actor, deliver, notSubscribed, type Subscriber } from './subscription'

/** Nobody subscribes to the region or waits to, and no write is asked of it. */
function idle(state: RegionState): boolean {
  return state.subscribers.size === 0 && state.joining.size === 0 && state.writes === 0
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
 * The regions a hub holds, by id: each from its first subscription or write, with its subscribers,
 * its queue of work (one piece at a time, in the order asked) and, once loaded, its log and document
 * from its own database, held until the region unloads. A region nobody subscribes to or writes any
 * more unloads after an idle time, and its database is released.
 */
export class HeldRegions {
  readonly #regions = new Map<string, RegionState>()
  readonly #databases: RegionDatabases
  readonly #clock: Clock
  readonly #idleUnloadMs: number
  readonly #onError: (error: DataError) => void
  #closed = false

  constructor(options: HeldRegionsOptions) {
    this.#databases = options.databases
    this.#clock = options.clock
    this.#idleUnloadMs = options.idleUnloadMs
    this.#onError = options.onError
  }

  /** `close` was called: no region is held or loaded from then on. */
  get closed(): boolean {
    return this.#closed
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
      writes: 0,
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
    return this.#queued(state, () =>
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
  }

  /**
   * Runs a write of the server's own on the region in its queue, holding and loading the region
   * first when it is not: from the moment it is asked until it settled, the region does not
   * unload, and then it unloads after the idle time when nobody subscribes, as after a device
   * left. Its outcome, a failure included, is the caller's.
   */
  write<T>(
    ref: RegionRef,
    work: (state: RegionState, loaded: Loaded) => ResultAsync<T, DataError>,
  ): ResultAsync<T, DataError> {
    const state = this.#regions.get(ref.id) ?? this.hold(ref)

    state.unload?.()
    state.unload = undefined
    state.writes += 1

    const run = Promise.resolve(
      this.#queued(state, () => this.load(state).andThen((loaded) => work(state, loaded))),
    ).finally(() => {
      state.writes -= 1
      this.unloadWhenIdle(state)
    })

    return new ResultAsync(run)
  }

  /** Runs `work` once the work asked of the region before it has settled, whatever its outcome. */
  #queued<T>(state: RegionState, work: () => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    const run = state.queue.then(() => work())

    state.queue = run.then(
      () => undefined,
      () => undefined,
    )

    return new ResultAsync(run)
  }

  /**
   * Schedules the region's unload once no device subscribes to it and no write is asked of it.
   * The unload runs in the region's queue, after the work asked before it, and only if it is
   * still idle; it releases the region's database. Once closed, nothing is scheduled: closing
   * released every database.
   */
  unloadWhenIdle(state: RegionState): void {
    if (this.#closed || state.unload || !idle(state)) {
      return
    }

    state.unload = this.#clock.schedule(this.#idleUnloadMs, () => {
      state.unload = undefined
      state.queue = state.queue.then(() => {
        if (idle(state) && this.#regions.get(state.ref.id) === state) {
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
   * releases the databases of the regions it held; it holds no region from then on.
   */
  async close(): Promise<void> {
    this.#closed = true

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
