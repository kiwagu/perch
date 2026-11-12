import type { VersionVector } from 'loro-crdt'
import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { ServerMessage } from '../../protocol'

import { exportFrom } from './export-from'
import type { Loaded, RegionState } from './region-state'
import type { Subscriber } from './subscription'

/** What answering a subscription needs of the hub. */
export interface SubscriptionIntake {
  /** Hands a message to a device; a send that throws is reported, and the work goes on. */
  readonly send: (subscriber: Subscriber, message: ServerMessage) => void
}

/** A device's subscription to a region, once the region is loaded for it. */
export interface RequestedSubscription {
  readonly regionId: string
  readonly subscriber: Subscriber
  /** What the device already holds; none asks for a full snapshot. */
  readonly from: VersionVector | null
}

/**
 * Answers a device's subscription in the region's queue, once the region is loaded: the device
 * joins the subscribers with the subscription `joining` holds now, which is not the one asked for
 * when `changeActor` replaced it while the subscription waited, and is sent what it lacks. A
 * device that left meanwhile is not answered and joins nothing; one that subscribed again keeps
 * the subscription it has.
 */
export function takeInSubscription(
  intake: SubscriptionIntake,
  { regionId, subscriber, from }: RequestedSubscription,
  state: RegionState,
  { log, doc }: Loaded,
): ResultAsync<void, DataError> {
  const joined = state.joining.get(subscriber.id)

  state.joining.delete(subscriber.id)

  const subscription = joined ?? state.subscribers.get(subscriber.id)

  if (!subscription) {
    return okAsync(undefined)
  }

  state.subscribers.set(subscriber.id, subscription)
  intake.send(subscriber, {
    type: 'updates',
    region: regionId,
    bytes: exportFrom(doc, from),
    head: log.head(),
    snapshot: from === null,
  })

  return okAsync(undefined)
}
