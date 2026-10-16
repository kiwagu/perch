import { type LoroDoc, VersionVector } from 'loro-crdt'
import { errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'

import type { Clock } from '../clock'
import type { CompactionOutcome, RejectReason, ServerMessage } from '../protocol'
import type { RegionRef } from '../region-doc'
import type { ReplicaSchema } from '../schema'

import { validateBatch } from './batch-validator'
import { messageOf, RegionLog } from './region-log'
import headsStatement from './surql/server-heads.surql'

/** One device's end of its subscriptions. */
export interface Subscriber {
  readonly id: string
  /**
   * Hands a message to the device; the hub never waits for it. A send that throws is reported
   * through `onError`, and the hub's work goes on.
   */
  send(message: ServerMessage): void
}

export interface RegionHubOptions {
  readonly local: LocalDb
  readonly schema: ReplicaSchema
  readonly clock: Clock
  /** How long a region nobody subscribes to stays in memory; 60 s by default. */
  readonly idleUnloadMs?: number
  /** How many log rows after the snapshot make an ack ask for a compaction; 200 by default. */
  readonly compactionLogLimit?: number
  /**
   * Hears of each failure of a region's work: one the device was answered with an internal
   * error for, a compaction snapshot the log refused to read, and a send that threw.
   */
  readonly onError: (error: DataError) => void
}

/** The longest `detail` a reject carries. */
const MAX_DETAIL = 200

/** A region's log and its authoritative document. */
interface Loaded {
  readonly log: RegionLog
  readonly doc: LoroDoc
}

/** What the hub keeps of one region, from the first subscription until it unloads the region. */
interface RegionState {
  readonly ref: RegionRef
  readonly owner: string | undefined
  /** Devices whose subscription was answered: each receives the batches the others push. */
  readonly subscribers: Map<string, Subscriber>
  /** Devices whose subscription waits in the queue for its answer. */
  readonly joining: Map<string, Subscriber>
  /** Settles once the work asked of the region so far has; the next work waits for it. */
  queue: Promise<void>
  /** The region's log and document, once the first subscription has loaded them. */
  loaded: Loaded | undefined
  /** Cancels the unload scheduled when the last device left. */
  unload: (() => void) | undefined
}

/** A region's head row as the database holds it. */
interface StoredHead {
  readonly region: string
  readonly head: number
}

const decodeVersion = Result.fromThrowable(
  (bytes: Uint8Array) => VersionVector.decode(bytes),
  (): ServerMessage => ({
    type: 'error',
    code: 'protocol',
    message: 'the version vector does not decode',
  }),
)

/**
 * What the document holds after `from`, or all of it as a snapshot without a version. Loro
 * types its bytes over any buffer while a message holds them in an ArrayBuffer of their own,
 * so they are copied into one.
 */
function exportFrom(doc: LoroDoc, from: VersionVector | null): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    from ? doc.export({ mode: 'update', from }) : doc.export({ mode: 'snapshot' }),
  )
}

function notSubscribed(region: string): ServerMessage {
  return { type: 'error', code: 'protocol', message: `not subscribed to region ${region}` }
}

/**
 * The server's copy of every region a device subscribes to: the region's log and its
 * authoritative document in memory. The work asked of one region (subscriptions, pulls,
 * pushes and compactions, the load that comes first) runs one piece at a time, in the order
 * it was asked. A pushed batch is checked on a fork of the document, accepted by the log
 * with its projection, then imported and sent to the region's other subscribers. A region
 * nobody subscribes to any more is dropped from memory after an idle time.
 */
export class RegionHub {
  readonly #regions = new Map<string, RegionState>()
  readonly #local: LocalDb
  readonly #schema: ReplicaSchema
  readonly #clock: Clock
  readonly #idleUnloadMs: number
  readonly #compactionLogLimit: number
  readonly #onError: (error: DataError) => void

  constructor(options: RegionHubOptions) {
    this.#local = options.local
    this.#schema = options.schema
    this.#clock = options.clock
    this.#idleUnloadMs = options.idleUnloadMs ?? 60_000
    this.#compactionLogLimit = options.compactionLogLimit ?? 200
    this.#onError = options.onError
  }

  /**
   * Subscribes a device to a region, loading the region first when the hub does not hold it,
   * and answers with what the device lacks: the updates after `vv`, or a full snapshot when
   * it has no version. From then on the device receives every batch the others push.
   */
  subscribe(
    region: RegionRef,
    owner: string | undefined,
    subscriber: Subscriber,
    vv: Uint8Array | null,
  ): ResultAsync<void, DataError> {
    const from = vv === null ? ok(null) : decodeVersion(vv)

    if (from.isErr()) {
      this.#send(subscriber, from.error)

      return okAsync(undefined)
    }

    const state = this.#regions.get(region.id) ?? this.#hold(region, owner)

    state.unload?.()
    state.unload = undefined
    state.joining.set(subscriber.id, subscriber)

    return this.#answer(state, subscriber, () =>
      this.#load(state)
        .andThen(({ log, doc }) => {
          // A device that left while its subscription waited is not answered.
          if (!state.joining.delete(subscriber.id) && !state.subscribers.has(subscriber.id)) {
            return okAsync(undefined)
          }

          state.subscribers.set(subscriber.id, subscriber)
          this.#send(subscriber, {
            type: 'updates',
            region: region.id,
            bytes: exportFrom(doc, from.value),
            head: log.head(),
            snapshot: from.value === null,
          })

          return okAsync(undefined)
        })
        .mapErr((error) => {
          // A device whose region could not be loaded is not subscribed.
          state.joining.delete(subscriber.id)
          this.#unloadWhenIdle(state)

          return error
        }),
    )
  }

  /** Ends a device's subscription; the region unloads once nobody has subscribed for the idle time. */
  unsubscribe(regionId: string, subscriberId: string): void {
    const state = this.#regions.get(regionId)

    if (!state) {
      return
    }

    state.joining.delete(subscriberId)
    state.subscribers.delete(subscriberId)
    this.#unloadWhenIdle(state)
  }

  /** Answers a subscribed device with the updates the region holds after `vv`. */
  pull(regionId: string, subscriber: Subscriber, vv: Uint8Array): ResultAsync<void, DataError> {
    const from = decodeVersion(vv)

    if (from.isErr()) {
      this.#send(subscriber, from.error)

      return okAsync(undefined)
    }

    return this.#subscribed(regionId, subscriber, (_, { log, doc }) => {
      this.#send(subscriber, {
        type: 'updates',
        region: regionId,
        bytes: exportFrom(doc, from.value),
        head: log.head(),
        snapshot: false,
      })

      return okAsync(undefined)
    })
  }

  /**
   * Checks a batch a subscribed device pushed and, when the log accepts it, acknowledges it
   * with its number and sends it to the region's other subscribers. A refused batch is
   * answered with a reject and changes nothing; a batch the region already holds, delivered
   * again, is acknowledged without a new log row.
   */
  push(
    regionId: string,
    subscriber: Subscriber,
    batch: number,
    updates: readonly Uint8Array[],
  ): ResultAsync<void, DataError> {
    const reject = (reason: RejectReason, detail: string) =>
      this.#send(subscriber, {
        type: 'reject',
        region: regionId,
        batch,
        reason,
        detail: detail.slice(0, MAX_DETAIL),
      })

    return this.#subscribed(regionId, subscriber, (state, { log, doc }) => {
      const validated = validateBatch({
        doc,
        region: state.ref,
        owner: state.owner,
        schema: this.#schema,
        updates,
      })

      if (validated.isErr()) {
        reject(validated.error.reason, validated.error.detail)

        return okAsync(undefined)
      }

      const { fork, plan } = validated.value

      // A batch delivered again brings nothing new: it is acknowledged under the current head,
      // without a log row that would move the head for nothing.
      if (fork.version().compare(doc.version()) === 0) {
        this.#send(subscriber, {
          type: 'ack',
          region: regionId,
          batch,
          head: log.head(),
          compact: false,
        })

        return okAsync(undefined)
      }

      return log
        .accept(plan)
        .andThen((head) => {
          // In a buffer of their own, as a message holds them (see `exportFrom`).
          const bytes = new Uint8Array(plan.bytes)

          doc.import(bytes)
          this.#send(subscriber, {
            type: 'ack',
            region: regionId,
            batch,
            head,
            compact: head - log.covers() > this.#compactionLogLimit,
          })

          for (const other of state.subscribers.values()) {
            if (other.id !== subscriber.id) {
              this.#send(other, { type: 'updates', region: regionId, bytes, head, snapshot: false })
            }
          }

          return okAsync(undefined)
        })
        .orElse((error) => {
          if (error.code !== 'data:WRITE_REJECTED') {
            return errAsync(error)
          }

          reject('invalid-record', messageOf(error.cause))

          return okAsync(undefined)
        })
    })
  }

  /** The head of each region asked: a loaded region's from its log, any other's from the database. */
  heads(
    regionIds: readonly string[],
  ): ResultAsync<ReadonlyArray<{ readonly region: string; readonly head: number }>, DataError> {
    const inMemory = (region: string) => this.#regions.get(region)?.loaded?.log.head()
    // A region may unload while the others are read, so the heads in memory are taken now.
    const held = new Map(regionIds.map((region) => [region, inMemory(region)]))
    const unloaded = regionIds.filter((region) => held.get(region) === undefined)
    const stored =
      unloaded.length === 0
        ? okAsync<StoredHead[], DataError>([])
        : ResultAsync.fromPromise(
            this.#local.db.query<[StoredHead[]]>(headsStatement, { regions: unloaded }),
            (cause) => dataError('data:QUERY_FAILED', 'could not read the heads of regions', cause),
          ).map(([rows]) => rows)

    return stored.map((rows) => {
      const heads = new Map(rows.map((row) => [row.region, row.head]))

      return regionIds.map((region) => ({
        region,
        head: inMemory(region) ?? held.get(region) ?? heads.get(region) ?? 0,
      }))
    })
  }

  /**
   * Hands a subscribed device's compaction proposal to the region's log and answers with the
   * outcome. A snapshot the log refuses to read (it does not decode, or it is shallow) is
   * answered as a version mismatch, which the device treats the same way, and reported.
   */
  compact(
    regionId: string,
    subscriber: Subscriber,
    covers: number,
    snapshot: Uint8Array,
  ): ResultAsync<void, DataError> {
    return this.#subscribed(regionId, subscriber, (_, { log }) =>
      log
        .compact(covers, snapshot)
        .orElse((error) => {
          if (error.code !== 'data:WRITE_REJECTED') {
            return errAsync(error)
          }

          this.#onError(error)

          return okAsync<CompactionOutcome, DataError>('version-mismatch')
        })
        .map((outcome) =>
          this.#send(subscriber, { type: 'compaction', region: regionId, covers, outcome }),
        ),
    )
  }

  /** How many regions have their document in memory. */
  loadedRegions(): number {
    return [...this.#regions.values()].filter((state) => state.loaded).length
  }

  /** Cancels the scheduled unloads, drops every region and waits for the work under way. */
  async close(): Promise<void> {
    const states = [...this.#regions.values()]

    this.#regions.clear()

    for (const state of states) {
      state.unload?.()
    }

    await Promise.all(states.map((state) => state.queue))
  }

  #hold(ref: RegionRef, owner: string | undefined): RegionState {
    const state: RegionState = {
      ref,
      owner,
      subscribers: new Map(),
      joining: new Map(),
      queue: Promise.resolve(),
      loaded: undefined,
      unload: undefined,
    }

    this.#regions.set(ref.id, state)

    return state
  }

  #load(state: RegionState): ResultAsync<Loaded, DataError> {
    if (state.loaded) {
      return okAsync(state.loaded)
    }

    return RegionLog.load(this.#local, state.ref.id).map((loaded) => {
      state.loaded = loaded

      return loaded
    })
  }

  /** Runs `work` on the region once the device has subscribed to it; any other device is refused. */
  #subscribed(
    regionId: string,
    subscriber: Subscriber,
    work: (state: RegionState, loaded: Loaded) => ResultAsync<void, DataError>,
  ): ResultAsync<void, DataError> {
    const state = this.#regions.get(regionId)

    if (!state) {
      this.#send(subscriber, notSubscribed(regionId))

      return okAsync(undefined)
    }

    return this.#answer(state, subscriber, () => {
      // A subscribed device's region is loaded: a region unloads only after its last device left.
      if (!state.loaded || !state.subscribers.has(subscriber.id)) {
        this.#send(subscriber, notSubscribed(regionId))

        return okAsync(undefined)
      }

      return work(state, state.loaded)
    })
  }

  /**
   * Runs `work` in the region's queue. A failure is reported and answered to the device as an
   * internal error, so the work always settles as answered.
   */
  #answer(
    state: RegionState,
    subscriber: Subscriber,
    work: () => ResultAsync<void, DataError>,
  ): ResultAsync<void, DataError> {
    const run = state.queue.then(() =>
      work().orElse((error) => {
        this.#onError(error)
        this.#send(subscriber, { type: 'error', code: 'internal', message: error.message })

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

  /** Hands a message to a device; a send that throws is reported, and the work goes on. */
  #send(subscriber: Subscriber, message: ServerMessage): void {
    try {
      subscriber.send(message)
    } catch (cause) {
      this.#onError(
        dataError(
          'data:WRITE_FAILED',
          `could not send ${message.type} to subscriber ${subscriber.id}`,
          cause,
        ),
      )
    }
  }

  /**
   * Schedules the region's unload once no device subscribes to it. The unload runs in the
   * region's queue, after the work asked before it, and only if still nobody subscribes.
   */
  #unloadWhenIdle(state: RegionState): void {
    if (state.unload || state.subscribers.size > 0 || state.joining.size > 0) {
      return
    }

    state.unload = this.#clock.schedule(this.#idleUnloadMs, () => {
      state.unload = undefined
      state.queue = state.queue.then(() => {
        const idle = state.subscribers.size === 0 && state.joining.size === 0

        if (idle && this.#regions.get(state.ref.id) === state) {
          this.#regions.delete(state.ref.id)
        }
      })
    })
  }
}
