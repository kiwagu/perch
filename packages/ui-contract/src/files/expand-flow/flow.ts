/**
 * A flow as a screen file authors it, expanded into the canonical flow every reader takes: the
 * states of the root, the regions of a parallel state (a pattern into the region it stands
 * for), the states of each region, and in every state its `entry`, `exit`, `on` and the
 * outcomes of its `invoke`. It works on the data as read, before any schema: what it does not
 * recognise it leaves as it is, so the canonical schema judges it with its own messages.
 */

import { isRecord } from '../../records'

import { effectsOf, transitionsOf } from './effects'
import type { CodesOf, Expansion, ExpansionIssue } from './expansion'
import { patternOf } from './patterns'

function stateOf(state: unknown, expansion: Expansion, at: readonly PropertyKey[]): unknown {
  if (!isRecord(state)) {
    return state
  }

  const out: Record<string, unknown> = { ...state }

  for (const key of ['entry', 'exit'] as const) {
    if (state[key] !== undefined) {
      out[key] = effectsOf(state[key], expansion, [...at, key])
    }
  }

  const { on, invoke } = state

  if (isRecord(on)) {
    out['on'] = Object.fromEntries(
      Object.entries(on).map(([event, value]) => [
        event,
        transitionsOf(value, expansion, [...at, 'on', event]),
      ]),
    )
  }

  if (isRecord(invoke)) {
    const outcomes: Record<string, unknown> = { ...invoke }

    for (const key of ['onDone', 'onError'] as const) {
      if (invoke[key] !== undefined) {
        outcomes[key] = transitionsOf(invoke[key], expansion, [...at, 'invoke', key])
      }
    }

    out['invoke'] = outcomes
  }

  if (state['type'] === 'parallel' && isRecord(state['states'])) {
    out['states'] = Object.fromEntries(
      Object.entries(state['states']).map(([name, region]) => [
        name,
        regionOf(region, expansion, [...at, 'states', name]),
      ]),
    )
  }

  return out
}

function regionOf(region: unknown, expansion: Expansion, at: readonly PropertyKey[]): unknown {
  const full = patternOf(region, expansion, at)

  if (!isRecord(full) || !isRecord(full['states'])) {
    return full
  }

  return {
    ...full,
    states: Object.fromEntries(
      Object.entries(full['states']).map(([name, state]) => [
        name,
        stateOf(state, expansion, [...at, 'states', name]),
      ]),
    ),
  }
}

/**
 * `flow` expanded, with the issues that kept a part of it from expanding (that part is left as
 * written). `codesOf` gives the codes an anchor declares, for `show: <anchor>`; `at` is where
 * the flow sits in its file.
 */
export function expandFlow(
  flow: unknown,
  codesOf: CodesOf,
  at: readonly PropertyKey[] = ['flow'],
): { flow: unknown; issues: ExpansionIssue[] } {
  const expansion: Expansion = { codesOf, issues: [] }

  if (!isRecord(flow) || !isRecord(flow['states'])) {
    return { flow, issues: [] }
  }

  const states = Object.fromEntries(
    Object.entries(flow['states']).map(([name, state]) => [
      name,
      stateOf(state, expansion, [...at, 'states', name]),
    ]),
  )

  return { flow: { ...flow, states }, issues: expansion.issues }
}
