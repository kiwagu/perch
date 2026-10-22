/**
 * Where a transition leads, as XState resolves a target from the parent of its state: from a
 * state of the root (a parallel state's own `on` included), a state of the flow or a deep
 * target `<parallel>.<region>.<state>`, each problem naming the missing piece; from a state
 * of a region, a state of that region. Its guard is declared in `meta.guards` and its effects
 * hold to the contract; per event at most one transition has no guard, and it is the last,
 * as XState takes the first whose guard holds.
 */

import type { FlowTransition, Problem } from '../../files'
import { has, own } from '../contract'

import type { At, InFlow } from './in-flow'
import { deepTargetOf, type RegionStateNode } from './nodes'
import { effectProblems } from './references'

type Transitions = FlowTransition | FlowTransition[]

/** What is missing for a target to be a state, or undefined when it is one. */
function missingOf(
  { flow }: InFlow,
  target: string,
  within: RegionStateNode | undefined,
): string | undefined {
  if (within !== undefined) {
    return has(within.siblings, target)
      ? undefined
      : `"${target}" is not a state of region "${within.region}"`
  }

  const deep = deepTargetOf(target)

  if (deep === undefined) {
    return has(flow.states, target) ? undefined : `"${target}" is not a state of the flow`
  }

  const parallel = own(flow.states, deep.parallel)
  const region = parallel?.type === 'parallel' ? own(parallel.states, deep.region) : undefined

  if (parallel?.type !== 'parallel') {
    return `"${target}": "${deep.parallel}" is not a parallel state`
  }

  if (region === undefined) {
    return `"${target}": "${deep.region}" is not a region of "${deep.parallel}"`
  }

  return has(region.states, deep.state)
    ? undefined
    : `"${target}": "${deep.state}" is not a state of region "${deep.region}"`
}

function transitionProblems(
  inFlow: InFlow,
  transition: FlowTransition,
  at: At,
  within: RegionStateNode | undefined,
): Problem[] {
  const { flow, inScreens } = inFlow
  const { target, guard } = transition
  const missing = target === undefined ? undefined : missingOf(inFlow, target, within)

  return [
    ...(missing === undefined ? [] : [inScreens([...at, 'target'], missing)]),
    ...(guard === undefined || has(flow.meta?.guards ?? {}, guard)
      ? []
      : [inScreens([...at, 'guard'], `"${guard}" is not a guard of meta.guards`)]),
    ...effectProblems(inFlow, transition.actions, [...at, 'actions']),
  ]
}

/** One transition or a list of them: at most one without a guard, and that one last. */
export function transitionsProblems(
  inFlow: InFlow,
  transitions: Transitions,
  at: At,
  within: RegionStateNode | undefined,
): Problem[] {
  const list = Array.isArray(transitions) ? transitions : [transitions]
  const unguarded = list.flatMap(({ guard }, index) => (guard === undefined ? [index] : []))
  const order =
    unguarded.length > 1
      ? [inFlow.inScreens(at, 'holds more than one transition without a guard')]
      : unguarded.filter((index) => index !== list.length - 1).length > 0
        ? [inFlow.inScreens(at, 'the transition without a guard is not the last')]
        : []

  return [
    ...order,
    ...list.flatMap((transition, index) =>
      transitionProblems(
        inFlow,
        transition,
        Array.isArray(transitions) ? [...at, index] : at,
        within,
      ),
    ),
  ]
}
