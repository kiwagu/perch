import type { LoroDoc, VersionVector } from 'loro-crdt'
import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { CompactionOutcome, ServerMessage } from '../../protocol'

import type { Loaded } from './region-state'
import type { Subscriber } from './subscription'

/** What taking a compaction proposal in needs of the hub. */
export interface CompactionIntake {
  /** Hands a message to a device; a send that throws is reported, and the work goes on. */
  readonly send: (subscriber: Subscriber, message: ServerMessage) => void
  /** Hears of a snapshot the log refused to read. */
  readonly onError: (error: DataError) => void
}

/** A compaction a subscribed device proposed for a region: the log row it covers, and its snapshot. */
export interface ProposedCompaction {
  readonly regionId: string
  readonly subscriber: Subscriber
  readonly covers: number
  readonly proposal: Uint8Array
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
 * Hands a subscribed device's compaction proposal to the region's log, in the region's queue,
 * and answers with the outcome. An accepted proposal is stored as the hub's own snapshot of the
 * region at that row, never as the device's bytes. A snapshot the log refuses to read (it does
 * not decode, or it is shallow) is answered as a version mismatch, which the device treats the
 * same way, and reported.
 */
export function takeInCompaction(
  intake: CompactionIntake,
  { regionId, subscriber, covers, proposal }: ProposedCompaction,
  { log, doc }: Loaded,
): ResultAsync<void, DataError> {
  return log
    .compact(covers, proposal, (version) =>
      snapshotAt(doc, covers === log.head() ? undefined : version),
    )
    .orElse((error) => {
      if (error.code !== 'data:WRITE_REJECTED') {
        return errAsync(error)
      }

      intake.onError(error)

      return okAsync<CompactionOutcome, DataError>('version-mismatch')
    })
    .map((outcome) =>
      intake.send(subscriber, { type: 'compaction', region: regionId, covers, outcome }),
    )
}
