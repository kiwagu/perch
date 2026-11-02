/**
 * A flow as a screen file authors it, expanded into the canonical flow every reader takes: the
 * states of the root, the regions of a parallel state (a pattern or a region written `by` a
 * button into the region it stands for), the states of each region, and in every state its
 * `entry`, `exit`, `on` and the outcomes of its `invoke`; then, on every invoke that writes no
 * `onError` and whose action fails with codes, the request pattern (`requests.ts`); then a
 * region for each button bound to one action that the flow handles nowhere; then, on every
 * invoke of a model action, the toast that says its success (`toasts/`). It works on the data
 * as read, before any schema: what it does not recognise it leaves as it is, so the canonical
 * schema judges it with its own messages.
 */

import { isRecord } from '../../records'

import { controlRegionOf, withDerivedRegions } from './controls'
import { effectsOf, transitionsOf } from './effects'
import type { DerivedToast, Expansion, ExpansionIssue, FlowLookups } from './expansion'
import { patternOf } from './patterns'
import { withDefaultOutcomes } from './requests'
import { withDerivedToasts } from './toasts'

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
    const src = typeof invoke['src'] === 'string' ? invoke['src'] : undefined

    for (const key of ['onDone', 'onError'] as const) {
      if (invoke[key] !== undefined) {
        const failing = key === 'onError' ? src : undefined

        outcomes[key] = transitionsOf(invoke[key], expansion, [...at, 'invoke', key], failing)
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
  const control = controlRegionOf(region, expansion, at)
  const { region: full, expanded } = control.expanded ? control : patternOf(region, expansion, at)

  if (expanded || !isRecord(full) || !isRecord(full['states'])) {
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
 * written), the toasts it derived and the codes it writes on the toast anchor itself. `lookups` give the codes an anchor carries and an action's
 * failure shows, for `show: <anchor>`, the screen's buttons bound to one action and the frame's
 * toast anchor; `at` is where the flow sits in its file.
 */
export function expandFlow(
  flow: unknown,
  lookups: FlowLookups,
  at: readonly PropertyKey[] = ['flow'],
): {
  flow: unknown
  issues: ExpansionIssue[]
  toasts: DerivedToast[]
  writtenToasts: string[]
} {
  const expansion: Expansion = { ...lookups, issues: [], toasts: [], writtenToasts: [] }

  if (!isRecord(flow) || !isRecord(flow['states'])) {
    return { flow, issues: [], toasts: [], writtenToasts: [] }
  }

  const states = Object.fromEntries(
    Object.entries(flow['states']).map(([name, state]) => [
      name,
      stateOf(state, expansion, [...at, 'states', name]),
    ]),
  )

  return {
    flow: {
      ...flow,
      states: withDerivedToasts(
        withDerivedRegions(withDefaultOutcomes({ ...flow, states }, expansion, at), expansion),
        expansion,
        at,
      ),
    },
    issues: expansion.issues,
    toasts: expansion.toasts,
    writtenToasts: expansion.writtenToasts,
  }
}
