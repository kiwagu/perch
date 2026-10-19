import { type LoroDoc, VersionVector } from 'loro-crdt'
import { errAsync, ok, okAsync, Result, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { CompactionOutcome, ServerMessage } from '../protocol'
import type { RegionRef } from '../region-doc'
import type { ReplicaSchema } from '../schema'

import { type BatchIntake, takeInBatch } from './batch-intake'
import { HeldRegions } from './held-regions'
import type { RegionDatabases } from './region-databases'
import { storedHeads } from './stored-heads'
import { type Actor, deliver, type Subscriber } from './subscription'

export type { Actor, Subscriber }

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

/**
 * The server's copy of every region a device subscribes to: the region's log and its
 * authoritative document in memory, from the region's own database, held while the region is
 * loaded. The work asked of one region (subscriptions, pulls, pushes and compactions, the load
 * that comes first) runs one piece at a time, in the order it was asked. A pushed batch is
 * checked on a fork of the document against the identity of the device that pushed it, and its
 * peers against the identities they write as, accepted by the log with its projection, then imported and sent to the region's other
 * subscribers. A region nobody subscribes to any more is dropped from memory after an idle
 * time, and its database released.
 */
export class RegionHub {
  readonly #held: HeldRegions
  readonly #databases: RegionDatabases
  readonly #onError: (error: DataError) => void
  readonly #intake: BatchIntake

  constructor(options: RegionHubOptions) {
    this.#databases = options.databases
    this.#onError = options.onError
    this.#held = new HeldRegions({
      databases: options.databases,
      clock: options.clock,
      idleUnloadMs: options.idleUnloadMs ?? 60_000,
      onError: options.onError,
    })
    this.#intake = {
      schema: options.schema,
      compactionLogLimit: options.compactionLogLimit ?? 200,
      send: (subscriber, message) => this.#send(subscriber, message),
    }
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

    const state = this.#held.get(region.id) ?? this.#held.hold(region)
    const subscription = { subscriber, actor }

    state.unload?.()
    state.unload = undefined
    state.joining.set(subscriber.id, subscription)

    return this.#held.answer(state, subscriber, () =>
      this.#held
        .load(state)
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
          this.#held.unloadWhenIdle(state)

          return error
        }),
    )
  }

  /** Ends a device's subscription; the region unloads once nobody has subscribed for the idle time. */
  unsubscribe(regionId: string, subscriberId: string): void {
    const state = this.#held.get(regionId)

    if (!state) {
      return
    }

    state.joining.delete(subscriberId)
    state.subscribers.delete(subscriberId)
    this.#held.unloadWhenIdle(state)
  }

  /** Answers a subscribed device with the updates the region holds after `vv`. */
  pull(regionId: string, subscriber: Subscriber, vv: Uint8Array): ResultAsync<void, DataError> {
    const from = decodeVersion(vv)

    if (from.isErr()) {
      this.#send(subscriber, from.error)

      return okAsync(undefined)
    }

    return this.#held.subscribed(regionId, subscriber, (_, { log, doc }) => {
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

  /** Takes in a batch a subscribed device pushed; the contract is `takeInBatch`'s. */
  push(
    regionId: string,
    subscriber: Subscriber,
    batch: number,
    updates: readonly Uint8Array[],
  ): ResultAsync<void, DataError> {
    return this.#held.subscribed(regionId, subscriber, (state, loaded, actor) =>
      takeInBatch(this.#intake, { regionId, subscriber, batch, updates }, state, loaded, actor),
    )
  }

  /**
   * The head of each region asked: a loaded region's from its log, any other's from its own
   * database, and 0 for a region without a log or one the hub does not know.
   */
  heads(
    regionIds: readonly string[],
  ): ResultAsync<ReadonlyArray<{ readonly region: string; readonly head: number }>, DataError> {
    const inMemory = (region: string) => this.#held.get(region)?.loaded?.log.head()
    // A region may unload while the others are read, so the heads in memory are taken now.
    const held = new Map(regionIds.map((region) => [region, inMemory(region)]))
    const unloaded = regionIds.filter((region) => held.get(region) === undefined)

    return storedHeads(this.#databases, unloaded).map((heads) =>
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
    return this.#held.subscribed(regionId, subscriber, (_, { log, doc }) =>
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
    return this.#held.loadedRegions()
  }

  /**
   * Cancels the scheduled unloads, drops every region, waits for the work under way, then
   * releases the databases of the regions it held.
   */
  close(): Promise<void> {
    return this.#held.close()
  }

  /** Hands a message to a device; a send that throws is reported, and the work goes on. */
  #send(subscriber: Subscriber, message: ServerMessage): void {
    deliver(subscriber, message, this.#onError)
  }
}
