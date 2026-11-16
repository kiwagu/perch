import type { RegionState } from './region-state'
import type { Actor } from './subscription'

/**
 * Judges the batches of the device `subscriberId` by `actor` from now on, in the region `state`
 * holds: its subscription takes the new actor, whether its answer was sent or is still waiting
 * in the region's queue. A device that did not subscribe to the region changes nothing, and
 * neither does the swap bring one into it.
 */
export function changeActor(state: RegionState, subscriberId: string, actor: Actor): void {
  for (const subscriptions of [state.subscribers, state.joining]) {
    const subscription = subscriptions.get(subscriberId)

    if (subscription) {
      subscriptions.set(subscriberId, { subscriber: subscription.subscriber, actor })
    }
  }
}
