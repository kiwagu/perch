import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'

import type { Clock } from '../clock'
import { COMPACTION_LOG_LIMIT } from '../compaction-limit'
import { MAX_PUSH_UPDATES, type ServerMessage } from '../protocol'
import type { RegionDoc } from '../region-doc'

import { LocalCatchUp } from './local-catch-up'
import { LocalCompaction } from './local-compaction'
import { ownBytes } from './message-bytes'
import type { DrainTarget } from './outbox-drain'
import { RegionCompaction } from './region-compaction'
import { RegionPull } from './region-pull'
import { type PushOutcome, RegionPush } from './region-push'
import { type Refusal, RegionRollback } from './region-rollback'
import type { RegionChannel, SyncTransport } from './transport'

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
  /** The gateway refused a batch again after its rollback: the sync stopped, reporting nothing. */
  readonly onReset: (refusal: Refusal) => void
  /**
   * How many outbox rows one push carries at most; 256 by default, the protocol's limit. The
   * push after a rollback carries every row up to the inverse, more when it takes more.
   */
  readonly batchRows?: number
  /** How many rows past its snapshot the local log holds before it is compacted; 200 by default. */
  readonly localCompactionRows?: number
}

type ErrorCode = Extract<ServerMessage, { readonly type: 'error' }>['code']

/**
 * Syncs one region document with the gateway over the transport. It subscribes with the
 * document's version once the gateway welcomes the device, imports what the server sends (one
 * message at a time, in the order they came) and pulls whenever an import leaves updates
 * waiting for history, until one completes; an import that fails pulls at once and again on
 * every full pass and reconnect, until the answer to a pull or a subscription imports in full.
 * It pushes the outbox one batch at a time; an acknowledged batch leaves the outbox, a rejected
 * one is rolled back by an inverse commit and pushed again together with it, whatever the batch
 * limit: the push after a rollback carries every row up to the inverse, the rows other tabs
 * queued in between included, as one update when they are more than a push may carry. A batch
 * rejected again after its rollback stops the sync without a report and asks for the region to
 * be reloaded (`onReset`). A push or a pull answered with an error, or not answered within 30
 * seconds, is given up for now and goes out again later (an unanswered one also has the
 * transport connect again); a subscription the gateway failed is sent again on the next full
 * pass or push. Once the server asks for a compaction and the region is quiet, it proposes a
 * full snapshot; once the local log holds more rows past its snapshot than the limit, a full pass
 * compacts it.
 */
export class RegionSync implements DrainTarget {
  readonly #region: RegionDoc
  readonly #transport: RegionChannel
  readonly #onError: (error: DataError) => void
  readonly #pull: RegionPull
  readonly #push: RegionPush
  readonly #rollback: RegionRollback
  readonly #compaction: RegionCompaction
  readonly #localCatchUp: LocalCatchUp
  readonly #localCompaction: LocalCompaction
  /** Settles once the server messages handed over so far are handled. */
  #queue: Promise<void> = Promise.resolve()
  /** A subscription went out on the current connection. */
  #subscribed = false
  /** Counts the subscriptions: a message tells which one it arrived under. */
  #epoch = 0
  /** The server has answered the subscription of the current connection. */
  #answered = false
  #stopped = false
  /**
   * The gateway's last welcome named the region, so the device may name it on this connection.
   * A region it did not name (the identity left its organisation meanwhile) is left alone.
   */
  #welcomed = true

  constructor(options: RegionSyncOptions) {
    const batchRows = options.batchRows ?? MAX_PUSH_UPDATES

    if (!Number.isInteger(batchRows) || batchRows < 1 || batchRows > MAX_PUSH_UPDATES) {
      throw new RangeError(`batchRows must be an integer from 1 to ${MAX_PUSH_UPDATES}`)
    }

    const localCompactionRows = options.localCompactionRows ?? COMPACTION_LOG_LIMIT

    if (!Number.isInteger(localCompactionRows) || localCompactionRows < 0) {
      throw new RangeError('localCompactionRows must be an integer from 0')
    }

    const { region, clock, onError } = options
    const stop = (error: DataError): void => this.#stop(error)
    // Nothing goes out for the region once it no longer syncs on this connection (retired, or
    // left out of the welcome), whatever work it had under way ends after that.
    const transport: RegionChannel = {
      send: (message) => this.syncing() && options.transport.send(message),
      reconnect: () => {
        if (this.syncing()) {
          options.transport.reconnect()
        }
      },
    }

    this.#region = region
    this.#transport = transport
    this.#onError = onError
    this.#localCatchUp = new LocalCatchUp(region, onError)
    this.#localCompaction = new LocalCompaction(region, localCompactionRows, onError)
    this.#pull = new RegionPull({
      region,
      transport,
      clock,
      onSettled: options.onSettled,
      onError,
      subscribed: () => this.#subscribed,
    })
    this.#compaction = new RegionCompaction({ region, transport, onError })
    this.#push = new RegionPush({
      region,
      transport,
      clock,
      onError,
      batchRows,
      gate: {
        // A region the welcome did not name pushes nothing on this connection, as a stopped one.
        stopped: () => this.#stopped || !this.#welcomed,
        subscribed: () => this.#subscribed,
        resubscribe: () => this.resubscribe(),
        catchUpLocal: () => this.catchUpLocal(),
        stop,
      },
      recoveryThrough: () => this.#rollback.recoveryThrough(),
      propose: (head) => this.#compaction.propose(head),
    })
    this.#rollback = new RegionRollback({
      region,
      actor: options.actor,
      onError,
      push: this.#push,
      stop,
      reset: (refusal) => {
        this.retire()
        options.onReset(refusal)
      },
    })
  }

  get id(): string {
    return this.#region.ref.id
  }

  /**
   * The gateway welcomed the device, naming the region or not: a named region subscribes; one it
   * did not name is left alone on this connection (nothing is sent for it, and it counts as
   * quiet) until a welcome names it again.
   */
  welcome(named: boolean): void {
    this.#welcomed = named

    if (named) {
      this.subscribe()
    }
  }

  /** The last welcome named the region; see `welcome`. */
  welcomed(): boolean {
    return this.#welcomed
  }

  /**
   * After `welcome`: subscribe with the document's version. Its answer is the updates the
   * document lacks, so it also serves as the pull an incomplete import left outstanding.
   */
  subscribe(): void {
    if (this.#stopped || !this.#welcomed) {
      return
    }

    const doc = this.#region.doc
    const version = doc.version()

    this.#epoch += 1
    this.#answered = false
    this.#pull.end()
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
    this.#pull.end()
    this.#compaction.forget()
    this.#push.land('down')
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

  /** Sends the next batch if one is waiting; see `RegionPush.next`. */
  pushNext(): Promise<PushOutcome> {
    return this.#push.next()
  }

  /**
   * Imports the rows other tabs appended to the local log; resolves false when that failed,
   * which is reported once until an import succeeds again. Every push and full pass asks for it.
   */
  catchUpLocal(): Promise<boolean> {
    return this.#localCatchUp.run()
  }

  /**
   * Compacts the local log once it holds more rows past its snapshot than the limit; a failure is
   * reported once until a compaction succeeds again. Every full pass asks for it.
   */
  async compactLocal(): Promise<void> {
    if (!this.#stopped) {
      await this.#localCompaction.run()
    }
  }

  /** Pulls when the server's head is ahead of the cursor. */
  catchUp(head: number): void {
    if (!this.#stopped && this.#answered && head > this.#region.pulled()) {
      this.#pull.request()
    }
  }

  /** Repeats the pull an incomplete or failed import left outstanding; every full pass asks for it. */
  retryPull(): void {
    if (!this.#stopped && this.#welcomed) {
      this.#pull.retry()
    }
  }

  /**
   * Nothing waits for an answer, and the server has answered the subscription of this
   * connection. A region that stopped syncing is quiet, and so is one the welcome did not name.
   */
  quiet(): boolean {
    return (
      this.#stopped ||
      !this.#welcomed ||
      (this.#answered &&
        !this.#push.inFlight() &&
        !this.#pull.pulling() &&
        !this.#compaction.pending())
    )
  }

  stopped(): boolean {
    return this.#stopped
  }

  /** Syncs on this connection: it neither stopped nor was left out of the welcome. */
  syncing(): boolean {
    return !this.#stopped && this.#welcomed
  }

  /**
   * Stops for good without a report: the region's document is replaced. Ends a pull and the
   * subscription, forgets a compaction and lands the push as empty; from then on nothing goes out
   * for the region, not even from work it had under way.
   */
  retire(): void {
    this.#stopped = true
    this.#subscribed = false
    this.#pull.end()
    this.#compaction.forget()
    this.#push.land('empty')
  }

  async #dispatch(message: ServerMessage, epoch: number): Promise<void> {
    if (this.#stopped || ('region' in message && message.region !== this.id)) {
      return
    }

    await match(message)
      .with({ type: 'updates' }, ({ bytes, head }) => this.#imported(bytes, head, epoch))
      .with({ type: 'ack' }, ({ batch, head, compact }) =>
        this.#push.acknowledged(batch, head, compact),
      )
      .with({ type: 'reject' }, ({ batch, reason, detail }) =>
        this.#rollback.rejected(batch, reason, detail),
      )
      .with({ type: 'compaction' }, ({ covers, outcome }) =>
        this.#compaction.compacted(covers, outcome),
      )
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
    const answering = current && (this.#pull.pulling() || !this.#answered)

    if (current) {
      this.#answered = true
      this.#pull.end()
    }

    await this.#pull.imported(bytes, head, answering)
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

    this.#pull.end()
    this.#compaction.forget()
    this.#push.land('down')
  }

  #stop(error: DataError): void {
    this.retire()
    this.#onError(error)
  }
}
