import { decodeImportBlobMeta, type LoroDoc } from 'loro-crdt'
import { ok, okAsync, Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import { MAX_PUSH_UPDATES } from '../protocol'
import type { OutboxRow, RegionDoc } from '../region-doc'

import { ownBytes } from './message-bytes'

/**
 * One update that holds exactly what `rows` hold, for a push of more rows than one message may
 * carry: the operations of each row, read back from the document, which holds every one of them.
 */
function coalesce(doc: LoroDoc, rows: readonly OutboxRow[]): Uint8Array {
  const spans = rows.flatMap((row) => {
    const meta = decodeImportBlobMeta(row.bytes, false)
    const start = meta.partialStartVersionVector.toJSON()

    return [...meta.partialEndVersionVector.toJSON()].map(([peer, end]) => {
      const counter = start.get(peer) ?? 0

      return { id: { peer, counter }, len: end - counter }
    })
  })

  return doc.export({ mode: 'updates-in-range', spans })
}

/**
 * The rows the next push carries: the oldest of the outbox, at most `limit`. After a rollback it
 * is every row up to the inverse, row `through`, instead, however many: the refused rows, those
 * other tabs queued behind them and the inverse go out together.
 */
export function nextBatch(
  region: RegionDoc,
  limit: number,
  through: number,
): ResultAsync<readonly OutboxRow[], DataError> {
  return region.outbox(limit).andThen((rows) => {
    const first = rows[0]
    const last = rows.at(-1)

    if (!first || !last || first.seq > through || last.seq >= through) {
      return okAsync(rows)
    }

    // The rows up to the inverse are no more than the numbers from the first to it.
    return region
      .outbox(through - first.seq + 1)
      .map((span) => span.filter((row) => row.seq <= through))
  })
}

/**
 * The updates one push of `rows` carries: the bytes of each row, or one update that holds them
 * all when they are more than a message may carry (a push after a rollback). `last` is the last
 * of `rows`; its number names the batch.
 */
export function batchUpdates(
  region: RegionDoc,
  rows: readonly OutboxRow[],
  last: OutboxRow,
): Result<Uint8Array<ArrayBuffer>[], DataError> {
  return rows.length <= MAX_PUSH_UPDATES
    ? ok(rows.map((row) => ownBytes(row.bytes)))
    : Result.fromThrowable(
        () => [ownBytes(coalesce(region.doc, rows))],
        (cause) =>
          dataError(
            'data:SYNC_STOPPED',
            `could not put batch ${last.seq} of ${region.ref.id} into one push; the region no longer syncs`,
            cause,
          ),
      )()
}
