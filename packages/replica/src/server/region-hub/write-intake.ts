import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import { planRecordWrite, type RecordWrite } from '../record-write'

import type { BatchIntake } from './batch-intake'
import type { Loaded, RegionState } from './region-state'

/**
 * Takes in a change of the server's own to one record of a region, in the region's queue, the
 * way a device's batch is taken in: once the log accepts it with its projection (binding no
 * peer), it is imported into the region's document and sent to every subscriber of the region;
 * resolves to its number. A write the replica schema or the projection refuses is a
 * `data:WRITE_REJECTED` and changes nothing; one that changes nothing resolves to the current
 * head, with no log row.
 */
export function takeInWrite(
  intake: BatchIntake,
  write: RecordWrite,
  state: RegionState,
  { log, doc }: Loaded,
): ResultAsync<number, DataError> {
  const planned = planRecordWrite({ doc, region: state.ref, schema: intake.schema, write })

  if (planned.isErr()) {
    return errAsync(planned.error)
  }

  const plan = planned.value

  if (plan === undefined) {
    return okAsync(log.head())
  }

  return log.accept(plan, 'server').map((head) => {
    // In a buffer of their own, as a message holds them (as `exportFrom` in the hub does).
    const bytes = new Uint8Array(plan.bytes)

    doc.import(bytes)

    for (const { subscriber } of state.subscribers.values()) {
      intake.send(subscriber, {
        type: 'updates',
        region: state.ref.id,
        bytes,
        head,
        snapshot: false,
      })
    }

    return head
  })
}
