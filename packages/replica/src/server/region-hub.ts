import { type LoroDoc, VersionVector } from 'loro-crdt'
import { errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { Ability } from '@workspace/kernel'

import type { Clock } from '../clock'
import { messageOf } from '../failure'
import type { CompactionOutcome, RejectReason, ServerMessage } from '../protocol'
import type { RegionRef } from '../region-doc'
import { regionRefOf } from '../region-ref'
import type { ReplicaSchema } from '../schema'

import { validateBatch } from './batch-validator'
import type { RegionDatabase, RegionDatabases } from './region-databases'
import { RegionLog } from './region-log'
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
  /** Where each region's log and projection live: held while the region is loaded. */
  readonly databases: RegionDatabases
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

/** A region's log and its authoritative document, and the hold on the database that keeps them. */
interface Loaded {
  readonly log: RegionLog
  readonly doc: LoroDoc
  readonly database: RegionDatabase
}

/** Who pushes through a subscription: the identity id its batches are checked against, and what it may do. */
export interface Actor {
  readonly id: string
  readonly ability: Ability
}

/** A device's subscription: its end, and the actor its batches are checked as. */
interface Subscription {
  readonly subscriber: Subscriber
  readonly actor: Actor
}

/** What the hub keeps of one region, from the first subscription until it unloads the region. */
interface RegionState {
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

/**
 * A full snapshot of the authoritative document: as it is, or as it was at `version`, a
 * version its history holds (a fork at that point keeps the whole history before it).
 */
function snapshotAt(doc: LoroDoc, version: VersionVector | undefined): Uint8Array {
  const at = version ? doc.forkAt(doc.vvToFrontiers(version)) : doc

  return at.export({ mode: 'snapshot' })
}

function notSubscribed(region: string): ServerMessage {
  return { type: 'error', code: 'protocol', message: `not subscribed to region ${region}` }
}

/**
 * The server's copy of every region a device subscribes to: the region's log and its
 * authoritative document in memory, from the region's own database, held while the region is
 * loaded. The work asked of one region (subscriptions, pulls, pushes and compactions, the load
 * that comes first) runs one piece at a time, in the order it was asked. A pushed batch is
 * checked on a fork of the document against the identity of the device that pushed it,
 * accepted by the log with its projection, then imported and sent to the region's other
 * subscribers. A region nobody subscribes to any more is dropped from memory after an idle
 * time, and its database released.
 */
export class RegionHub {
  readonly #regions = new Map<string, RegionState>()
  readonly #databases: RegionDatabases
  readonly #schema: ReplicaSchema
  readonly #clock: Clock
  readonly #idleUnloadMs: number
  readonly #compactionLogLimit: number
  readonly #onError: (error: DataError) => void

  constructor(options: RegionHubOptions) {
    this.#databases = options.databases
    this.#schema = options.schema
    this.#clock = options.clock
    this.#idleUnloadMs = options.idleUnloadMs ?? 60_000
    this.#compactionLogLimit = options.compactionLogLimit ?? 200
    this.#onError = options.onError
  }

  /**
   * Subscribes a device to a region, loading the region first when the hub does not hold it,
   * and answers with what the device lacks: the updates after `vv`, or a full snapshot when
   * it has no version. From then on the device receives every batch the others push, and the
   * batches it pushes are checked against `actor`: the identity id of the device and its ability.
   */
  subscribe(
    region: RegionRef,
    actor: Actor,
    subscriber: Subscriber,
    vv: Uint8Array | null,
  ): ResultAsync<void, DataError> {
    const from = vv === null ? ok(null) : decodeVersion(vv)

    if (from.isErr()) {
      this.#send(subscriber, from.error)

      return okAsync(undefined)
    }

    const state = this.#regions.get(region.id) ?? this.#hold(region)
    const subscription = { subscriber, actor }

    state.unload?.()
    state.unload = undefined
    state.joining.set(subscriber.id, subscription)

    return this.#answer(state, subscriber, () =>
      this.#load(state)
        .andThen(({ log, doc }) => {
          // A device that left while its subscription waited is not answered.
          if (!state.joining.delete(subscriber.id) && !state.subscribers.has(subscriber.id)) {
            return okAsync(undefined)
          }

          state.subscribers.set(subscriber.id, subscription)
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
   * answered with a reject and changes nothing (`foreign-owner` when it writes a record of
   * another region); a batch the region already holds, delivered again, is acknowledged
   * without a new log row.
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

    return this.#subscribed(regionId, subscriber, (state, { log, doc }, actor) => {
      const validated = validateBatch({
        doc,
        region: state.ref,
        actor: actor.id,
        ability: actor.ability,
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

          for (const { subscriber: other } of state.subscribers.values()) {
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

          // A record of another region, or a projection that breaks a schema rule.
          if (error.message.startsWith('ownership')) {
            reject('foreign-owner', error.message)
          } else {
            reject('invalid-record', messageOf(error.cause))
          }

          return okAsync(undefined)
        })
    })
  }

  /**
   * The head of each region asked: a loaded region's from its log, any other's from its own
   * database, and 0 for a region without a log or one the hub does not know.
   */
  heads(
    regionIds: readonly string[],
  ): ResultAsync<ReadonlyArray<{ readonly region: string; readonly head: number }>, DataError> {
    const inMemory = (region: string) => this.#regions.get(region)?.loaded?.log.head()
    // A region may unload while the others are read, so the heads in memory are taken now.
    const held = new Map(regionIds.map((region) => [region, inMemory(region)]))
    const unloaded = regionIds.filter((region) => held.get(region) === undefined)

    return this.#storedHeads(unloaded).map((heads) =>
      regionIds.map((region) => ({
        region,
        head: inMemory(region) ?? held.get(region) ?? heads.get(region) ?? 0,
      })),
    )
  }

  /**
   * Hands a subscribed device's compaction proposal to the region's log and answers with the
   * outcome. An accepted proposal is stored as the hub's own snapshot of the region at that
   * row, never as the device's bytes. A snapshot the log refuses to read (it does not decode,
   * or it is shallow) is answered as a version mismatch, which the device treats the same way,
   * and reported.
   */
  compact(
    regionId: string,
    subscriber: Subscriber,
    covers: number,
    proposal: Uint8Array,
  ): ResultAsync<void, DataError> {
    return this.#subscribed(regionId, subscriber, (_, { log, doc }) =>
      log
        .compact(covers, proposal, (version) =>
          snapshotAt(doc, covers === log.head() ? undefined : version),
        )
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

  /**
   * The heads the databases hold for regions not in memory, by region: one query per
   * database, which is released once it answered. A region the hub does not know is not asked.
   */
  #storedHeads(regionIds: readonly string[]): ResultAsync<ReadonlyMap<string, number>, DataError> {
    // Every private region lives in the same database; each tenant region has one of its own.
    const groups = new Map<string, { readonly ref: RegionRef; readonly ids: string[] }>()

    for (const id of regionIds) {
      const ref = regionRefOf(id)
      const database = ref?.kind === 'private' ? 'directory' : ref?.id

      if (ref && database) {
        const group = groups.get(database) ?? { ref, ids: [] }

        group.ids.push(id)
        groups.set(database, group)
      }
    }

    return ResultAsync.combine(
      [...groups.values()].map(({ ref, ids }) => this.#headsIn(ref, ids)),
    ).map((lists) => new Map(lists.flat().map((row) => [row.region, row.head])))
  }

  /** The heads the database of `ref` holds for `regionIds`, all kept in that database. */
  #headsIn(ref: RegionRef, regionIds: readonly string[]): ResultAsync<StoredHead[], DataError> {
    return this.#databases.acquire(ref).andThen(({ local, release }) => {
      const read = async (): Promise<Result<StoredHead[], DataError>> => {
        try {
          return await ResultAsync.fromPromise(
            local.db.query<[StoredHead[]]>(headsStatement, { regions: regionIds }),
            (cause) => dataError('data:QUERY_FAILED', 'could not read the heads of regions', cause),
          ).map(([rows]) => rows)
        } finally {
          release()
        }
      }

      return new ResultAsync(read())
    })
  }

  #hold(ref: RegionRef): RegionState {
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
  #load(state: RegionState): ResultAsync<Loaded, DataError> {
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
  #subscribed(
    regionId: string,
    subscriber: Subscriber,
    work: (state: RegionState, loaded: Loaded, actor: Actor) => ResultAsync<void, DataError>,
  ): ResultAsync<void, DataError> {
    const state = this.#regions.get(regionId)

    if (!state) {
      this.#send(subscriber, notSubscribed(regionId))

      return okAsync(undefined)
    }

    return this.#answer(state, subscriber, () => {
      const subscription = state.subscribers.get(subscriber.id)

      // A subscribed device's region is loaded: a region unloads only after its last device left.
      if (!state.loaded || !subscription) {
        this.#send(subscriber, notSubscribed(regionId))

        return okAsync(undefined)
      }

      return work(state, state.loaded, subscription.actor)
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
   * region's queue, after the work asked before it, and only if still nobody subscribes; it
   * releases the region's database.
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
          state.loaded?.database.release()
          state.loaded = undefined
        }
      })
    })
  }
}
