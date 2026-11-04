/** Where a state of a flow stands, and the states a transition's target enters from there. */

import { recordOf } from '../records'

/** Where a state stands: itself, the states beside it, and the states of the root. */
export interface Place {
  readonly self: unknown
  readonly siblings: Readonly<Record<string, unknown>>
  readonly root: Readonly<Record<string, unknown>>
}

/**
 * The states a transition enters at `node`, following `inside` (a region, then its state): a
 * plain state itself; a parallel state, in each region the state `inside` names or else its
 * initial one.
 */
function enteredAt(node: unknown, inside: readonly string[]): unknown[] {
  if (recordOf(node)['type'] !== 'parallel') {
    return [node]
  }

  const [regionName, stateName] = inside

  return Object.entries(recordOf(recordOf(node)['states'])).flatMap(([name, region]) => {
    const initial = recordOf(region)['initial']
    const chosen = name === regionName && stateName !== undefined ? stateName : initial

    return typeof chosen === 'string' ? [recordOf(recordOf(region)['states'])[chosen]] : []
  })
}

/**
 * The states a transition's `target` enters: a state beside it, a state of the root or a region's
 * state named from the root (`<parallel>.<region>.<state>`), or one by `#<flow id>.<state>`.
 */
export function enteredBy(target: unknown, place: Place): unknown[] {
  if (typeof target !== 'string') {
    return []
  }

  const byId = target.startsWith('#')
  const path = byId ? target.split('.').slice(1) : target.split('.')
  const [first = '', ...inside] = path

  return !byId && path.length === 1
    ? enteredAt(place.siblings[target], [])
    : enteredAt(place.root[first], inside)
}
