import { type DataError, dataError } from '@workspace/data'
import type { Ability } from '@workspace/kernel'

import type { ServerMessage } from '../../protocol'

/** One device's end of its subscriptions. */
export interface Subscriber {
  readonly id: string
  /**
   * Hands a message to the device; the hub never waits for it. A send that throws is reported
   * through `onError`, and the hub's work goes on.
   */
  send(message: ServerMessage): void
}

/** Who pushes through a subscription: the identity id its batches are checked against, and what it may do. */
export interface Actor {
  readonly id: string
  readonly ability: Ability
}

/** A device's subscription: its end, and the actor its batches are checked as. */
export interface Subscription {
  readonly subscriber: Subscriber
  readonly actor: Actor
}

/** The answer to a device that names a region it has not subscribed to. */
export function notSubscribed(region: string): ServerMessage {
  return { type: 'error', code: 'protocol', message: `not subscribed to region ${region}` }
}

/** Hands a message to a device; a send that throws is reported through `onError`, and the work goes on. */
export function deliver(
  subscriber: Subscriber,
  message: ServerMessage,
  onError: (error: DataError) => void,
): void {
  try {
    subscriber.send(message)
  } catch (cause) {
    onError(
      dataError(
        'data:WRITE_FAILED',
        `could not send ${message.type} to subscriber ${subscriber.id}`,
        cause,
      ),
    )
  }
}
