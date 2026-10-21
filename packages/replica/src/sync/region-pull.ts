import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'
import type { RegionDoc } from '../region-doc'

import { ANSWER_TIMEOUT_MS, NO_TIMEOUT } from './answer-timeout'
import { ownBytes } from './message-bytes'
import type { RegionChannel } from './transport'

export interface RegionPullOptions {
  readonly region: RegionDoc
  readonly transport: RegionChannel
  /** Times how long a pull waits for its answer. */
  readonly clock: Clock
  /** Imported something from the server. */
  readonly onSettled: () => void
  readonly onError: (error: DataError) => void
  /** A subscription went out on the current connection: a pull goes out only under one. */
  readonly subscribed: () => boolean
}

/**
 * Brings what the server sends into one region document: imports each update, pulls whenever an
 * import leaves updates waiting for history until one completes, and after an import that failed
 * pulls at once, then again whenever a full pass or a reconnect asks, until an answer imports in
 * full. A pull not answered within 30 seconds is given up, reported, and the connection made again.
 */
export class RegionPull {
  readonly #region: RegionDoc
  readonly #transport: RegionChannel
  readonly #clock: Clock
  readonly #onSettled: () => void
  readonly #onError: (error: DataError) => void
  readonly #subscribed: () => boolean
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

  constructor(options: RegionPullOptions) {
    this.#region = options.region
    this.#transport = options.transport
    this.#clock = options.clock
    this.#onSettled = options.onSettled
    this.#onError = options.onError
    this.#subscribed = options.subscribed
  }

  get id(): string {
    return this.#region.ref.id
  }

  /** A pull went out and no updates arrived since. */
  pulling(): boolean {
    return this.#pulling
  }

  /** Repeats the pull an incomplete or failed import left outstanding. */
  retry(): void {
    if (this.#incomplete || this.#lost) {
      this.request()
    }
  }

  /**
   * Imports what the server sent. `answering` tells that it answers the subscription or the pull of
   * the current connection: only such an answer, imported in full, ends the repeats of a failed import.
   */
  async imported(bytes: Uint8Array, head: number, answering: boolean): Promise<void> {
    const outcome = await this.#region.importRemote(bytes, head)

    if (outcome.isErr()) {
      // The region lacks what the server sent, whatever imports cleanly later: pull it now, once.
      // While it stays lost, a persistent failure would pull at round-trip rate: the full pass
      // and a reconnect repeat the pull instead.
      const first = !this.#lost

      this.#lost = true
      this.#onError(outcome.error)

      if (first) {
        this.request()
      }

      return
    }

    this.#incomplete = !outcome.value.complete

    if (answering && outcome.value.complete) {
      this.#lost = false
    }

    if (this.#incomplete) {
      this.request()
    }

    this.#onSettled()
  }

  /** Pulls what the document lacks, unless a pull is out or no subscription is. */
  request(): void {
    if (!this.#subscribed() || this.#pulling) {
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
  end(): void {
    this.#pulling = false
    this.#cancelPullTimeout()
    this.#cancelPullTimeout = NO_TIMEOUT
  }
}
