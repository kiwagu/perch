/**
 * What the state of a screen's machine renders, read from the machine itself: its states carry
 * their flow's `meta.renders`, which the engine's `renderedAt` and `isRendered` read as the e2e
 * harness reads the flow. A view shows an anchor only some states render where the state the
 * machine is in renders it, never by a flag or a list of states of its own.
 */

import type { StateValue } from 'xstate'

import { isRendered, renderedAt } from '@workspace/ui-contract/anchors'

/** Whether the machine of `config`, in the state `value`, renders an anchor. */
export function rendersIn(config: unknown, value: StateValue): (anchor: string) => boolean {
  const at = renderedAt(config, value)

  return (anchor) => isRendered(at, anchor)
}
