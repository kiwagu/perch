import { sameValue } from '../../records'

import { aheadOf } from './ahead'
import type { Projection } from './projection'

/**
 * What an app's machine must equal while its flow runs ahead of it on a branch. The flow at the
 * branch's base, when the machine is still exactly that: the app has not started on what the
 * branch changed in the flow, a transition changed included, which `aheadOf` alone would refuse.
 * Otherwise the flow now less what the machine has not built yet (`aheadOf`). Without a base,
 * only the second holds.
 */
export function laggingOf(
  app: Projection,
  flow: Projection,
  base: Projection | undefined,
): Projection {
  return base !== undefined && sameValue(app, base) ? base : aheadOf(app, flow)
}
