import { type DataError, dataError } from '@workspace/data'

import type { CompactionOutcome } from '../protocol'
import type { RegionDoc } from '../region-doc'

import { ownBytes } from './message-bytes'
import type { RegionChannel } from './transport'

export interface RegionCompactionOptions {
  readonly region: RegionDoc
  readonly transport: RegionChannel
  readonly onError: (error: DataError) => void
}

/**
 * Proposes a full snapshot of one region once the server asks for a compaction and nothing local
 * is left to push, and hears the outcome; one proposal is out at a time.
 */
export class RegionCompaction {
  readonly #region: RegionDoc
  readonly #transport: RegionChannel
  readonly #onError: (error: DataError) => void
  /** A compaction proposal went out and its outcome has not arrived. */
  #compacting = false

  constructor(options: RegionCompactionOptions) {
    this.#region = options.region
    this.#transport = options.transport
    this.#onError = options.onError
  }

  get id(): string {
    return this.#region.ref.id
  }

  /** A proposal went out and its outcome has not arrived. */
  pending(): boolean {
    return this.#compacting
  }

  /** No outcome will come for the proposal out: the channel fell, or the gateway answered with an error. */
  forget(): void {
    this.#compacting = false
  }

  /**
   * Proposes a full snapshot as the server's log up to `head`, once nothing local is left to
   * push and the document holds exactly what the server's log holds there.
   */
  async propose(head: number): Promise<void> {
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

  /** The gateway's outcome of a proposal: a refusal other than a lost race is reported. */
  async compacted(covers: number, outcome: CompactionOutcome): Promise<void> {
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
}
