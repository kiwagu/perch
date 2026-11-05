/**
 * The descriptions a screen file writes: the screen's own, each parameter of its routes, each
 * anchor's, each entry of its container `states` (what is visible in that state) and those of its
 * flow (`flow.ts`). What the engine derives (a heading's, a link's, a secret input's, an error's,
 * a composite's anchors') is never written, so never read.
 */

import { entriesOf, recordOf } from '../../records'

import { flowDescriptions } from './flow'
import { describedAt, type Found, isList, meaningsAt, nameOf } from './found'

const SLOTS = ['params', 'search'] as const

/** The descriptions of the parameters of the screen's routes, each by its route's path. */
const bindingsAt = (bindings: unknown, screen: string): Found[] =>
  (isList(bindings) ? bindings : []).flatMap((binding, index) => {
    const path = nameOf(binding, 'path', `a binding of ${screen}`)

    return SLOTS.flatMap((slot) =>
      entriesOf(recordOf(recordOf(binding)[slot])['properties']).flatMap(([name, parameter]) =>
        describedAt(
          parameter,
          ['bindings', index, slot, 'properties', name],
          'parameter',
          `${screen} binding ${path} ${slot} ${name}`,
        ),
      ),
    )
  })

/** The descriptions the screen file `value` writes, in the order of the file. */
export function screenDescriptions(value: unknown): Found[] {
  const screen = nameOf(value, 'id', 'a screen file')
  const { bindings, anchors, states, flow } = recordOf(value)

  return [
    ...describedAt(value, [], 'screen', screen),
    ...bindingsAt(bindings, screen),
    ...entriesOf(anchors).flatMap(([anchor, def]) =>
      describedAt(def, ['anchors', anchor], 'anchor', anchor),
    ),
    ...meaningsAt(states, ['states'], 'containerState', (name) => `${screen} state ${name}`),
    ...(flow === undefined ? [] : flowDescriptions(flow, screen)),
  ]
}
