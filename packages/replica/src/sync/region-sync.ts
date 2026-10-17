import { decodeImportBlobMeta, type LoroDoc, VersionVector } from 'loro-crdt'
import { okAsync, Result, type ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'

import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import {
  type CompactionOutcome,
  MAX_PUSH_UPDATES,
  type RejectReason,
  type ServerMessage,
} from '../protocol'
import type { OutboxRow, RegionDoc } from '../region-doc'

import type { DrainTarget } from './outbox-drain'
import type { SyncTransport } from './transport'

export interface RegionSyncOptions {
  readonly region: RegionDoc
  readonly transport: SyncTransport
  /** Times how long a push or a pull waits for its answer. */
  readonly clock: Clock
  /** Who the inverse commit of a rejected batch is written as. */
  readonly actor: string
  /** Imported something from the server. */
  readonly onSettled: () => void
  readonly onError: (error: DataError) => void
  /** How many outbox rows one push carries at most; 256 by default, the protocol's limit. */
  readonly batchRows?: number
}

type PushOutcome = 'sent' | 'empty' | 'down'

type ErrorCode = Extract<ServerMessage, { readonly type: 'error' }>['code']

/**
 * How long a push, a pull or a probe waits for its answer before it is given up for now, and
 * the connection with it: a connection that stopped answering is closed and made again.
 */
export const ANSWER_TIMEOUT_MS = 30_000

const NO_TIMEOUT = (): void => {}

/** A pushed batch waiting for its answer. */
interface Flight {
  readonly batch: number
  readonly rows: readonly OutboxRow[]
  /**
   * Rows of it went out before and were given up without an answer: the server may hold them
   * already, and its ack then names the current head rather than this batch's.
   */
  readonly retried: boolean
  readonly landed: Promise<PushOutcome>
  readonly land: (outcome: PushOutcome) => void
}

/** Loro types exported bytes over any buffer, a message holds them in an ArrayBuffer of their own. */
function ownBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes)
}

/**
 * Applies to `doc` the inverse of what `rows` changed: the difference from the document right
 * after the rows back to the document right before them, keeping every change of other peers.
 * Applied to the document itself, a field the rows deleted comes back with its content in full.
 */
function invert(doc: LoroDoc, rows: readonly OutboxRow[]): void {
  const metas = rows.map((row) => decodeImportBlobMeta(row.bytes, false))
  const current = doc.version().toJSON()
  const start = new Map(current)
  const end = new Map(current)

  for (const meta of metas) {
    for (const [peer, counter] of meta.partialStartVersionVector.toJSON()) {
      start.set(peer, Math.min(start.get(peer) ?? counter, counter))
    }
  }

  const touched = new Set(
    metas.flatMap((meta) => [...meta.partialEndVersionVector.toJSON().keys()]),
  )

  for (const peer of touched) {
    end.set(
      peer,
      Math.max(...metas.map((meta) => meta.partialEndVersionVector.toJSON().get(peer) ?? 0)),
    )
  }

  const before = doc.vvToFrontiers(new VersionVector(start))
  const after = doc.vvToFrontiers(new VersionVector(end))

  doc.applyDiff(doc.diff(after, before, false), { fullState: true })
}

/**
 * Syncs one region document with the gateway over the transport. It subscribes with the
 * document's version once the gateway welcomes the device, imports what the server sends (one
 * message at a time, in the order they came) and pulls whenever an import leaves updates
 * waiting for history, until one completes; an import that fails pulls at once and again on
 * every full pass and reconnect, until the answer to a pull or a subscription imports in full.
 * It pushes the outbox one batch at a time; an
 * acknowledged batch leaves the outbox, a rejected one is rolled back by an inverse commit
 * and pushed again together with it, and a batch rejected again after its rollback stops the
 * region's sync. A push or a pull answered with an error, or not answered within 30 seconds, is
 * given up for now and goes out again later (an unanswered one also has the transport connect
 * again); a subscription the gateway failed is sent again on
 * the next full pass or push. Once the server asks for a compaction and the region is quiet, it
 * proposes a full snapshot.
 */
export class RegionSync implements DrainTarget {
  readonly #region: RegionDoc
  readonly #transport: SyncTransport
  readonly #clock: Clock
  readonly #actor: string
  readonly #onSettled: () => void
  readonly #onError: (error: DataError) => void
  readonly #batchRows: number
  /** Settles once the server messages handed over so far are handled. */
  #queue: Promise<void> = Promise.resolve()
  /** A subscription went out on the current connection. */
  #subscribed = false
  /** Counts the subscriptions: a message tells which one it arrived under. */
  #epoch = 0
  /** The server has answered the subscription of the current connection. */
  #answered = false
  #flight: Flight | undefined
  /** Gives the push in flight up when its answer does not come in time. */
  #cancelPushTimeout = NO_TIMEOUT
  /** A pull went out and no updates arrived since. */
  #pulling = false
  /** Gives the pull up when its answer does not come in time. */
  #cancelPullTimeout = NO_TIMEOUT
  /** An import left updates waiting for their history; pulls repeat until one completes. */
  #incomplete = false
  /**
   * An import of what the server sent failed, so the document lacks it although the cursor may
   * move past it: pulls repeat until the answer to a pull or a subscription imports in full.
   */
  #lost = false
  /** The last batch given up without an answer: a push of rows up to it may be a redelivery. */
  #givenUpThrough = 0
  /** A compaction proposal went out and its outcome has not arrived. */
  #compacting = false
  /** The last outbox row a rollback covered: a batch rejected again from there stops the region. */
  #revertedThrough = 0
  #stopped = false

  constructor(options: RegionSyncOptions) {
    const batchRows = options.batchRows ?? MAX_PUSH_UPDATES

    if (!Number.isInteger(batchRows) || batchRows < 1 || batchRows > MAX_PUSH_UPDATES) {
      throw new RangeError(`batchRows must be an integer from 1 to ${MAX_PUSH_UPDATES}`)
    }

    this.#region = options.region
    this.#transport = options.transport
    this.#clock = options.clock
    this.#actor = options.actor
    this.#onSettled = options.onSettled
    this.#onError = options.onError
    this.#batchRows = batchRows
  }

  get id(): string {
    return this.#region.ref.id
  }

  /**
   * After `welcome`: subscribe with the document's version. Its answer is the updates the
   * document lacks, so it also serves as the pull an incomplete import left outstanding.
   */
  subscribe(): void {
    if (this.#stopped) {
      return
    }

    const doc = this.#region.doc
    const version = doc.version()

    this.#epoch += 1
    this.#answered = false
    this.#endPull()
    this.#subscribed = this.#transport.send({
      type: 'subscribe',
      region: this.id,
      vv: version.length() === 0 ? null : ownBytes(version.encode()),
    })
  }

  /**
   * Subscribes again when the gateway failed the subscription of this connection; a full pass
   * and every push ask for it. While the channel is down the subscription does not go out.
   */
  resubscribe(): void {
    if (!this.#subscribed) {
      this.subscribe()
    }
  }

  /** The channel fell: the subscription is gone, and a push in flight will not be answered. */
  channelDown(): void {
    this.#subscribed = false
    this.#answered = false
    this.#endPull()
    this.#compacting = false
    this.#land('down')
  }

  /**
   * Handles a message of this region once the ones before it are handled. Failures are reported
   * through `onError`; it rejects only on a broken invariant, which does not hold up the next.
   */
  handle(message: ServerMessage): Promise<void> {
    const epoch = this.#epoch
    const handled = this.#queue.then(() => this.#dispatch(message, epoch))

    this.#queue = handled.then(
      () => undefined,
      () => undefined,
    )

    return handled
  }

  async pushNext(): Promise<PushOutcome> {
    if (this.#stopped) {
      return 'empty'
    }

    if (this.#flight) {
      return this.#flight.landed
    }

    this.resubscribe()

    if (!this.#subscribed) {
      return 'down'
    }

    const rows = await this.#region
      .flush()
      // An update whose append failed is the write path's to report; what is durable goes out.
      .orElse(() => okAsync(undefined))
      .andThen(() => this.#region.outbox(this.#batchRows))

    if (rows.isErr()) {
      this.#onError(rows.error)

      return 'down'
    }

    const last = rows.value.at(-1)

    if (!last) {
      return 'empty'
    }

    if (this.#stopped || this.#flight || !this.#subscribed) {
      return this.#stopped ? 'empty' : 'down'
    }

    let land: (outcome: PushOutcome) => void = () => {}
    const landed = new Promise<PushOutcome>((resolve) => {
      land = resolve
    })
    const flight: Flight = {
      batch: last.seq,
      rows: rows.value,
      retried: (rows.value[0]?.seq ?? 0) <= this.#givenUpThrough,
      landed,
      land,
    }

    this.#flight = flight

    if (
      !this.#transport.send({
        type: 'push',
        region: this.id,
        batch: flight.batch,
        updates: flight.rows.map((row) => ownBytes(row.bytes)),
      })
    ) {
      this.#flight = undefined

      return 'down'
    }

    this.#cancelPushTimeout = this.#clock.schedule(ANSWER_TIMEOUT_MS, () => {
      if (this.#flight === flight) {
        this.#onError(
          dataError(
            'data:QUERY_FAILED',
            `the gateway did not answer batch ${flight.batch} of ${this.id} within ${ANSWER_TIMEOUT_MS} ms`,
          ),
        )
        this.#land('down')
        this.#transport.reconnect()
      }
    })

    return landed
  }

  /** Pulls when the server's head is ahead of the cursor. */
  catchUp(head: number): void {
    if (!this.#stopped && this.#answered && head > this.#region.pulled()) {
      this.#pull()
    }
  }

  /** Repeats the pull an incomplete or failed import left outstanding; every full pass asks for it. */
  retryPull(): void {
    if (!this.#stopped && (this.#incomplete || this.#lost)) {
      this.#pull()
    }
  }

  /**
   * Nothing waits for an answer, and the server has answered the subscription of this
   * connection. A region that stopped syncing is quiet.
   */
  quiet(): boolean {
    return this.#stopped || (this.#answered && !this.#flight && !this.#pulling && !this.#compacting)
  }

  stopped(): boolean {
    return this.#stopped
  }

  async #dispatch(message: ServerMessage, epoch: number): Promise<void> {
    if (this.#stopped || ('region' in message && message.region !== this.id)) {
      return
    }

    await match(message)
      .with({ type: 'updates' }, ({ bytes, head }) => this.#imported(bytes, head, epoch))
      .with({ type: 'ack' }, ({ batch, head, compact }) => this.#acknowledged(batch, head, compact))
      .with({ type: 'reject' }, ({ batch, reason, detail }) =>
        this.#rejected(batch, reason, detail),
      )
      .with({ type: 'compaction' }, ({ covers, outcome }) => this.#compacted(covers, outcome))
      .with({ type: 'error' }, async ({ code }) => this.#failed(code, epoch))
      .otherwise(async () => {})
  }

  /**
   * Imports what the server sent under the subscription numbered `epoch`. The first updates
   * after a subscription answer it; the first after a pull are taken as the pull's answer.
   */
  async #imported(bytes: Uint8Array, head: number, epoch: number): Promise<void> {
    // Updates that came over a connection since gone do not answer the current subscription.
    const current = epoch === this.#epoch && this.#subscribed
    const answering = current && (this.#pulling || !this.#answered)

    if (current) {
      this.#answered = true
      this.#endPull()
    }

    const outcome = await this.#region.importRemote(bytes, head)

    if (outcome.isErr()) {
      // The region lacks what the server sent, whatever imports cleanly later: pull it now.
      this.#lost = true
      this.#onError(outcome.error)
      this.#pull()

      return
    }

    this.#incomplete = !outcome.value.complete

    if (answering && outcome.value.complete) {
      this.#lost = false
    }

    if (this.#incomplete) {
      this.#pull()
    }

    this.#onSettled()
  }

  /**
   * The server holds the batch and every row before it, so they leave the outbox, also when
   * the push was given up meanwhile; only the push in flight lands.
   */
  async #acknowledged(batch: number, head: number, compact: boolean): Promise<void> {
    const acknowledged = await this.#region.acknowledge(batch)

    if (acknowledged.isErr()) {
      // The rows stay in the outbox and go out again; the server acknowledges them as known.
      this.#onError(acknowledged.error)
      this.#landIf(batch, 'down')

      return
    }

    // The server took nothing from others between the cursor and this batch. Only the ack of
    // a first push names the batch's own head: a batch the server held already is acknowledged
    // under its current head, which may hold batches of others this device never imported.
    const flight = this.#flight
    const firstPush = flight?.batch === batch && !flight.retried

    if (firstPush && this.#region.pulled() === head - 1) {
      const moved = await this.#region.advanceCursor(head)

      if (moved.isErr()) {
        this.#onError(moved.error)
      }
    }

    if (compact) {
      await this.#proposeCompaction(head)
    }

    this.#landIf(batch, 'sent')
  }

  async #rejected(batch: number, reason: RejectReason, detail: string): Promise<void> {
    const flight = this.#flight

    if (flight?.batch !== batch) {
      return
    }

    const refusal = `${reason}: ${detail}`

    if ((flight.rows[0]?.seq ?? 0) <= this.#revertedThrough) {
      this.#stop(
        dataError(
          'data:SYNC_STOPPED',
          `the gateway rejected batch ${batch} of ${this.id} again after its rollback (${refusal}); the region no longer syncs`,
        ),
      )

      return
    }

    const reverted = await this.#revert(flight)

    if (reverted.isErr()) {
      this.#stop(reverted.error)

      return
    }

    this.#revertedThrough = batch
    // The next push carries the rejected rows and their inverse.
    this.#land('sent')
  }

  /**
   * Commits the inverse of a rejected batch and makes it durable, so it lands in the outbox
   * behind the rows it undoes. The rows of other tabs are imported first: the inverse is
   * worked out on a document that holds every row of the batch.
   */
  #revert(flight: Flight): ResultAsync<void, DataError> {
    const doc = this.#region.doc
    const commit = Result.fromThrowable(
      () => {
        invert(doc, flight.rows)
        doc.commit({
          message: JSON.stringify({
            actor: this.#actor,
            command: 'sync.revert',
            correlationId: String(flight.batch),
          }),
        })
      },
      (cause) =>
        dataError(
          'data:SYNC_STOPPED',
          `could not roll back batch ${flight.batch} of ${this.id}; the region no longer syncs`,
          cause,
        ),
    )

    return this.#region
      .catchUpLocal()
      .andThen(() => commit())
      .andThen(() => this.#region.flush())
  }

  /**
   * Proposes a full snapshot as the server's log up to `head`, once nothing local is left to
   * push and the document holds exactly what the server's log holds there.
   */
  async #proposeCompaction(head: number): Promise<void> {
    if (this.#compacting) {
      return
    }

    const waiting = await this.#region
      .flush()
      .andThen(() => this.#region.catchUpLocal())
      .andThen(() => this.#region.outbox(1))

    if (waiting.isErr()) {
      this.#onError(waiting.error)

      return
    }

    if (waiting.value.length > 0 || this.#region.pulled() !== head) {
      return
    }

    this.#compacting = this.#transport.send({
      type: 'compact',
      region: this.id,
      covers: head,
      snapshot: ownBytes(this.#region.doc.export({ mode: 'snapshot' })),
    })
  }

  async #compacted(covers: number, outcome: CompactionOutcome): Promise<void> {
    this.#compacting = false

    // A stale proposal lost to one that covers more; the others mean the snapshot was wrong.
    if (outcome === 'version-mismatch' || outcome === 'beyond-head') {
      this.#onError(
        dataError(
          'data:WRITE_REJECTED',
          `the gateway refused to compact ${this.id} up to ${covers}: ${outcome}`,
        ),
      )
    }
  }

  /**
   * The gateway answered with an error. Errors name no request, so whatever waits for an answer
   * is given up for now: a push in flight stays in the outbox and goes out again on the next
   * local write, full pass or reconnect, and a pull goes out again when one is due. An internal
   * or protocol error before the subscription was answered means the gateway did not subscribe
   * the device: the region subscribes again on the next full pass or push.
   */
  #failed(code: ErrorCode, epoch: number): void {
    const failedSubscription =
      (code === 'internal' || code === 'protocol') &&
      epoch === this.#epoch &&
      this.#subscribed &&
      !this.#answered

    if (failedSubscription) {
      this.#subscribed = false
    }

    this.#endPull()
    this.#compacting = false
    this.#land('down')
  }

  #pull(): void {
    if (!this.#subscribed || this.#pulling) {
      return
    }

    this.#pulling = this.#transport.send({
      type: 'pull',
      region: this.id,
      vv: ownBytes(this.#region.doc.version().encode()),
    })

    if (this.#pulling) {
      this.#cancelPullTimeout = this.#clock.schedule(ANSWER_TIMEOUT_MS, () => {
        this.#cancelPullTimeout = NO_TIMEOUT
        this.#pulling = false
        this.#onError(
          dataError(
            'data:QUERY_FAILED',
            `the gateway did not answer a pull of ${this.id} within ${ANSWER_TIMEOUT_MS} ms`,
          ),
        )
        this.#transport.reconnect()
      })
    }
  }

  /** The pull out was answered or given up. */
  #endPull(): void {
    this.#pulling = false
    this.#cancelPullTimeout()
    this.#cancelPullTimeout = NO_TIMEOUT
  }

  #landIf(batch: number, outcome: PushOutcome): void {
    if (this.#flight?.batch === batch) {
      this.#land(outcome)
    }
  }

  #land(outcome: PushOutcome): void {
    const flight = this.#flight

    // A push given up without an answer may have reached the server all the same.
    if (flight && outcome === 'down') {
      this.#givenUpThrough = Math.max(this.#givenUpThrough, flight.batch)
    }

    this.#flight = undefined
    this.#cancelPushTimeout()
    this.#cancelPushTimeout = NO_TIMEOUT
    flight?.land(outcome)
  }

  #stop(error: DataError): void {
    this.#stopped = true
    this.#onError(error)
    this.#land('empty')
  }
}
