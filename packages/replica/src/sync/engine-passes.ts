import { type DataError, dataError } from '@workspace/data'

import type { Clock } from '../clock'

import { ANSWER_TIMEOUT_MS } from './answer-timeout'
import type { PassKind } from './cadence'
import type { SyncedRegion } from './engine-settling'
import type { OutboxDrainPort } from './outbox-drain'
import type { SyncTransport } from './transport'

export interface EnginePassesOptions {
  readonly regions: ReadonlyMap<string, SyncedRegion>
  readonly transport: SyncTransport
  /** Times how long a probe waits for its heads. */
  readonly clock: Clock
  readonly drain: OutboxDrainPort
  readonly onError: (error: DataError) => void
  /** A pass ended or a probe was given up: what a settled check reads changed. */
  readonly changed: () => void
}

/**
 * The passes the cadence runs. Each probes the heads of every region; a full pass also subscribes
 * again where the gateway failed a subscription, repeats outstanding pulls, imports what other tabs
 * wrote, drains the outbox and compacts the local logs grown long. Heads name no probe, so each answer settles the oldest probe out; a
 * probe not answered within 30 seconds is given up, reported, and the connection made again.
 */
export class EnginePasses {
  readonly #regions: ReadonlyMap<string, SyncedRegion>
  readonly #transport: SyncTransport
  readonly #clock: Clock
  readonly #drain: OutboxDrainPort
  readonly #onError: (error: DataError) => void
  readonly #changed: () => void
  /**
   * Probes sent on this connection whose heads have not arrived, oldest first, each as the
   * cancel of its answer timeout. Heads name no probe, so each answer settles the oldest.
   */
  #probes: Array<() => void> = []
  #passing = false

  constructor(options: EnginePassesOptions) {
    this.#regions = options.regions
    this.#transport = options.transport
    this.#clock = options.clock
    this.#drain = options.drain
    this.#onError = options.onError
    this.#changed = options.changed
  }

  /** No pass runs and no probe waits for its heads. */
  idle(): boolean {
    return !this.#passing && this.#probes.length === 0
  }

  /** Heads arrived: they answer the oldest probe out. */
  answered(): void {
    this.#probes.shift()?.()
  }

  async run(kind: PassKind): Promise<void> {
    this.#passing = true

    try {
      // A region the welcome did not name is not asked for.
      const probed = [...this.#regions].flatMap(([id, { sync }]) => (sync.welcomed() ? [id] : []))

      if (this.#transport.send({ type: 'probe', regions: probed })) {
        this.#awaitHeads()
      }

      if (kind === 'full') {
        for (const { sync } of this.#regions.values()) {
          sync.resubscribe()
          sync.retryPull()
        }

        // What other tabs wrote reaches this document even while the channel is down.
        await Promise.all([...this.#regions.values()].map(({ sync }) => sync.catchUpLocal()))
        this.#drain.request()
        await this.#drain.idle()
        await Promise.all([...this.#regions.values()].map(({ sync }) => sync.compactLocal()))
      }
    } finally {
      this.#passing = false
      this.#changed()
    }
  }

  /** The probes out will not be answered on this connection. */
  forgetProbes(): void {
    for (const cancel of this.#probes.splice(0)) {
      cancel()
    }
  }

  /**
   * Waits for the heads of a probe just sent; when none come within 30 seconds the probe is
   * given up, reported, and the connection, which stopped answering, is made again.
   */
  #awaitHeads(): void {
    const cancel = this.#clock.schedule(ANSWER_TIMEOUT_MS, () => {
      this.#probes = this.#probes.filter((pending) => pending !== cancel)
      this.#onError(
        dataError(
          'data:QUERY_FAILED',
          `the gateway did not answer a probe within ${ANSWER_TIMEOUT_MS} ms`,
        ),
      )
      this.#transport.reconnect()
      this.#changed()
    })

    this.#probes.push(cancel)
  }
}
