import { decodeImportBlobMeta, type LoroDoc, VersionVector } from 'loro-crdt'
import { Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import type { RejectReason } from '../protocol'
import type { OutboxRow, RegionDoc } from '../region-doc'

import type { Flight, RegionPush } from './region-push'

/**
 * Applies to `doc` the inverse of what `rows` changed: the difference from the document right
 * after the rows back to the document right before them, keeping every change of other peers.
 * Applied to the document itself, a field the rows deleted comes back with its content in full.
 */
export function invert(doc: LoroDoc, rows: readonly OutboxRow[]): void {
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

export interface RegionRollbackOptions {
  readonly region: RegionDoc
  /** Who the inverse commit of a rejected batch is written as. */
  readonly actor: string
  readonly onError: (error: DataError) => void
  /** The push whose rejected batch is rolled back; it carries the rollback out. */
  readonly push: RegionPush
  /** Stops the region's sync and reports why. */
  readonly stop: (error: DataError) => void
}

/**
 * Rolls a batch the gateway rejected back with an inverse commit, made durable behind the rows it
 * undoes, so the next push carries the refused rows and their undo together, whatever the batch
 * limit. A batch rejected again after its rollback stops the region's sync.
 */
export class RegionRollback {
  readonly #region: RegionDoc
  readonly #actor: string
  readonly #onError: (error: DataError) => void
  readonly #push: RegionPush
  readonly #stop: (error: DataError) => void
  /** The last outbox row a rollback covered: a batch rejected again from there stops the region. */
  #revertedThrough = 0
  /**
   * The outbox row of the latest rollback's inverse: until it is acknowledged, a push carries
   * every row up to it, so the refused rows never go out again without their undo.
   */
  #recoveryThrough = 0

  constructor(options: RegionRollbackOptions) {
    this.#region = options.region
    this.#actor = options.actor
    this.#onError = options.onError
    this.#push = options.push
    this.#stop = options.stop
  }

  get id(): string {
    return this.#region.ref.id
  }

  /** The outbox row of the latest rollback's inverse (0 before the first rollback). */
  recoveryThrough(): number {
    return this.#recoveryThrough
  }

  /** The gateway rejected batch `batch`: the push in flight is rolled back, or the region stops when it was rolled back before. */
  async rejected(batch: number, reason: RejectReason, detail: string): Promise<void> {
    const flight = this.#push.inFlight()

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

    this.#onError(
      dataError(
        'data:PUSH_REJECTED',
        `the gateway rejected batch ${batch} of ${this.id} (${refusal}); the change is undone on this device`,
        { region: this.id, batch, reason, detail },
      ),
    )

    const reverted = await this.#revert(flight)

    if (reverted.isErr()) {
      this.#stop(reverted.error)

      return
    }

    this.#revertedThrough = batch
    // The next push carries the rejected rows and their inverse, the last row this device wrote.
    this.#recoveryThrough = this.#region.persistedSeq()
    this.#push.land('sent')
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
}
