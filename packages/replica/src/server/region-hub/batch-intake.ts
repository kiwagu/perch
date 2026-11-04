import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import { messageOf } from '../../failure'
import type { RejectReason, ServerMessage } from '../../protocol'
import type { ReplicaSchema } from '../../schema'
import { validateBatch } from '../batch-validator'
import { batchWriter } from '../batch-writer'

import type { Loaded, RegionState } from './region-state'
import type { Actor, Subscriber } from './subscription'

/** The longest `detail` a reject carries. */
const MAX_DETAIL = 200

/** What taking a batch in needs of the hub. */
export interface BatchIntake {
  readonly schema: ReplicaSchema
  /** How many log rows after the snapshot make an ack ask for a compaction. */
  readonly compactionLogLimit: number
  /** Hands a message to a device; a send that throws is reported, and the work goes on. */
  readonly send: (subscriber: Subscriber, message: ServerMessage) => void
}

/** A batch a device pushed to a region. */
export interface PushedBatch {
  readonly regionId: string
  readonly subscriber: Subscriber
  readonly batch: number
  readonly updates: readonly Uint8Array[]
}

/**
 * Takes in a batch a subscribed device pushed, in the region's queue: checks it on a fork of the
 * region's document against `actor` and, when the log accepts it with its projection and binds the
 * peers whose changes it brings to the pushing identity, imports it,
 * acknowledges it with its number and sends it to the region's other subscribers. A refused batch
 * is answered with a reject and changes nothing (`foreign-owner` when it writes a record of another
 * region, `foreign-peer` when it brings changes under the server's Loro peer or under one another
 * identity's batch was accepted under in the region); a batch the region already holds, delivered
 * again, is acknowledged without a new log row.
 */
export function takeInBatch(
  intake: BatchIntake,
  { regionId, subscriber, batch, updates }: PushedBatch,
  state: RegionState,
  { log, doc }: Loaded,
  actor: Actor,
): ResultAsync<void, DataError> {
  const reject = (reason: RejectReason, detail: string) =>
    intake.send(subscriber, {
      type: 'reject',
      region: regionId,
      batch,
      reason,
      detail: detail.slice(0, MAX_DETAIL),
    })

  const validated = validateBatch({
    doc,
    region: state.ref,
    actor: actor.id,
    ability: actor.ability,
    schema: intake.schema,
    updates,
  })

  if (validated.isErr()) {
    reject(validated.error.reason, validated.error.detail)

    return okAsync(undefined)
  }

  const { fork, plan } = validated.value

  // A batch delivered again brings nothing new: it is acknowledged under the current head,
  // without a log row that would move the head for nothing.
  if (fork.version().compare(doc.version()) === 0) {
    intake.send(subscriber, {
      type: 'ack',
      region: regionId,
      batch,
      head: log.head(),
      compact: false,
    })

    return okAsync(undefined)
  }

  return log
    .accept(plan, batchWriter(actor.id, doc, fork))
    .andThen((head) => {
      // In a buffer of their own, as a message holds them (as `exportFrom` in the hub does).
      const bytes = new Uint8Array(plan.bytes)

      doc.import(bytes)
      intake.send(subscriber, {
        type: 'ack',
        region: regionId,
        batch,
        head,
        compact: head - log.covers() > intake.compactionLogLimit,
      })

      for (const { subscriber: other } of state.subscribers.values()) {
        if (other.id !== subscriber.id) {
          intake.send(other, { type: 'updates', region: regionId, bytes, head, snapshot: false })
        }
      }

      return okAsync(undefined)
    })
    .orElse((error) => {
      if (error.code !== 'data:WRITE_REJECTED') {
        return errAsync(error)
      }

      // A record of another region, the server's peer or one another identity writes as, or a
      // projection that breaks a schema rule.
      if (error.message.startsWith('ownership')) {
        reject('foreign-owner', error.message)
      } else if (error.message.startsWith('peer')) {
        reject('foreign-peer', error.message)
      } else {
        reject('invalid-record', messageOf(error.cause))
      }

      return okAsync(undefined)
    })
}
