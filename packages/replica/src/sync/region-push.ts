import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { OutboxRow, RegionDoc } from '../region-doc'

import { ANSWER_TIMEOUT_MS, NO_TIMEOUT } from './answer-timeout'
import { batchUpdates, nextBatch } from './outbox-batch'
import type { SyncTransport } from './transport'

export type PushOutcome = 'sent' | 'empty' | 'down'

/** A pushed batch waiting for its answer. */
export interface Flight {
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

/** What a push asks of its region's sync before a batch goes out. */
export interface PushGate {
  /** The region stopped syncing: nothing goes out any more. */
  stopped(): boolean
  /** A subscription went out on the current connection. */
  subscribed(): boolean
  /** Subscribes again when the gateway failed the subscription of this connection. */
  resubscribe(): void
  /** Imports the rows other tabs appended; false when that failed. */
  catchUpLocal(): Promise<boolean>
  /** Stops the region's sync and reports why. */
  stop(error: DataError): void
}

export interface RegionPushOptions {
  readonly region: RegionDoc
  readonly transport: SyncTransport
  /** Times how long a push waits for its answer. */
  readonly clock: Clock
  readonly onError: (error: DataError) => void
  /** How many outbox rows one push carries at most, outside a rollback's recovery push. */
  readonly batchRows: number
  readonly gate: PushGate
  /** The outbox row of the latest rollback's inverse: until it is acknowledged, a push carries every row up to it. */
  readonly recoveryThrough: () => number
  /** Proposes a full snapshot up to `head`: the ack of a batch asked for a compaction. */
  readonly propose: (head: number) => Promise<void>
}

/**
 * Pushes one region's outbox one batch at a time. An acknowledged batch leaves the outbox; a push
 * answered with an error, or not answered within 30 seconds, is given up for now and goes out again
 * later (an unanswered one also has the transport connect again).
 */
export class RegionPush {
  readonly #region: RegionDoc
  readonly #transport: SyncTransport
  readonly #clock: Clock
  readonly #onError: (error: DataError) => void
  readonly #batchRows: number
  readonly #gate: PushGate
  readonly #recoveryThrough: () => number
  readonly #propose: (head: number) => Promise<void>
  #flight: Flight | undefined
  /** Gives the push in flight up when its answer does not come in time. */
  #cancelPushTimeout = NO_TIMEOUT
  /** The last batch given up without an answer: a push of rows up to it may be a redelivery. */
  #givenUpThrough = 0
  /** The rows of each batch pushed and not acknowledged yet, also after it was given up. */
  readonly #pushed = new Map<number, readonly OutboxRow[]>()

  constructor(options: RegionPushOptions) {
    this.#region = options.region
    this.#transport = options.transport
    this.#clock = options.clock
    this.#onError = options.onError
    this.#batchRows = options.batchRows
    this.#gate = options.gate
    this.#recoveryThrough = options.recoveryThrough
    this.#propose = options.propose
  }

  get id(): string {
    return this.#region.ref.id
  }

  /** The pushed batch waiting for its answer, if any. */
  inFlight(): Flight | undefined {
    return this.#flight
  }

  /** Sends the next batch if one is waiting; resolves when it is acknowledged, rejected or the channel fell. */
  async next(): Promise<PushOutcome> {
    if (this.#gate.stopped()) {
      return 'empty'
    }

    if (this.#flight) {
      return this.#flight.landed
    }

    this.#gate.resubscribe()

    if (!this.#gate.subscribed()) {
      return 'down'
    }

    // An update whose append failed is the write path's to report; what is durable goes out.
    await this.#region.flush().unwrapOr(undefined)

    // The outbox holds the rows of every tab, and an ack may move the cursor past them: this
    // document imports them before any goes out. Nothing goes out when that fails; the next
    // write, full pass or reconnect tries again.
    if (!(await this.#gate.catchUpLocal())) {
      return 'down'
    }

    const rows = await nextBatch(this.#region, this.#batchRows, this.#recoveryThrough())

    if (rows.isErr()) {
      this.#onError(rows.error)

      return 'down'
    }

    const last = rows.value.at(-1)

    if (!last) {
      return 'empty'
    }

    // Another tab may have appended rows since the catch-up: the document takes in exactly the
    // rows it pushes, so an ack that moves the cursor over them leaves none of them out.
    const imported = this.#region.importLocal(rows.value)

    if (imported.isErr()) {
      this.#onError(imported.error)

      return 'down'
    }

    if (this.#gate.stopped() || this.#flight || !this.#gate.subscribed()) {
      return this.#gate.stopped() ? 'empty' : 'down'
    }

    // A push of a rollback may hold more rows than a message carries: they go out as one update.
    const updates = batchUpdates(this.#region, rows.value, last)

    if (updates.isErr()) {
      this.#gate.stop(updates.error)

      return 'empty'
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
    this.#pushed.set(flight.batch, flight.rows)

    if (
      !this.#transport.send({
        type: 'push',
        region: this.id,
        batch: flight.batch,
        updates: updates.value,
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
        this.land('down')
        this.#transport.reconnect()
      }
    })

    return landed
  }

  /**
   * The server holds the batch, so the rows pushed in it leave the outbox, also when the push
   * was given up meanwhile; only the push in flight lands. Rows are dropped by id, never by
   * number: another engine on the same database may hold a row under a number this one pushed.
   */
  async acknowledged(batch: number, head: number, compact: boolean): Promise<void> {
    const rows = this.#pushed.get(batch) ?? []

    // A batch covers the batches before it that were pushed again inside it.
    for (const pushed of this.#pushed.keys()) {
      if (pushed <= batch) {
        this.#pushed.delete(pushed)
      }
    }

    const acknowledged = await this.#region.acknowledge(rows)

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
      await this.#propose(head)
    }

    this.#landIf(batch, 'sent')
  }

  #landIf(batch: number, outcome: PushOutcome): void {
    if (this.#flight?.batch === batch) {
      this.land(outcome)
    }
  }

  /** Lands the push in flight, if any; one given up without an answer may have reached the server all the same. */
  land(outcome: PushOutcome): void {
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
}
