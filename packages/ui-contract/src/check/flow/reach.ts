/**
 * Every state is reachable and every plain state has a way out. The states of the root are
 * reached from `initial` through the targets of the root (a deep target reaches its parallel
 * state) and the id targets out of the regions of a parallel state; the states of a region
 * from the region's `initial` and the states of it a deep target of the root names, through
 * the region's targets; a transition without a target stays. A plain state, of the root or of
 * a region, that is not final has an event or an invoke to leave it; a parallel state is never
 * stuck, as its regions move, and needs no event of its own.
 */

import type { FlowTransition, Problem } from '../../files'
import {
  deepEnteredOf,
  type FlowNode,
  flowNodes,
  idTargetOf,
  rootOf,
  transitionsOf,
} from '../../files'
import { has } from '../contract'

import type { InFlow } from './in-flow'

/** The names reached from `seeds`, each state's transitions read once. */
function reachedFrom(
  seeds: readonly string[],
  states: Readonly<Record<string, unknown>>,
  transitionsAt: (name: string) => readonly FlowTransition[],
  landing: (target: string) => string,
): Set<string> {
  const reached = new Set<string>()
  const next = seeds.filter((seed) => has(states, seed))

  for (let name = next.pop(); name !== undefined; name = next.pop()) {
    const first = !reached.has(name)

    reached.add(name)
    next.push(
      ...(first ? transitionsAt(name) : [])
        .flatMap(({ target }) => (target === undefined ? [] : [landing(target)]))
        .filter((target) => has(states, target) && !reached.has(target)),
    )
  }

  return reached
}

const unreachable = (
  states: Readonly<Record<string, unknown>>,
  reached: ReadonlySet<string>,
): string[] => Object.keys(states).filter((name) => !reached.has(name))

/**
 * The transitions that leave a state of the root: of a parallel one, its own and the id targets
 * of its regions' states.
 */
function rootTransitionsOf(nodes: readonly FlowNode[], name: string): FlowTransition[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'region-state' && node.parallel === name) {
      return transitionsOf(node.state).filter(
        ({ target }) => target !== undefined && idTargetOf(target) !== undefined,
      )
    }

    return (node.kind === 'root' || node.kind === 'parallel') && node.name === name
      ? transitionsOf(node.state)
      : []
  })
}

export function unreachableProblems({ flow, at, inScreens }: InFlow): Problem[] {
  const nodes = flowNodes(flow)
  const deep = deepEnteredOf(flow)
  const root = reachedFrom(
    [flow.initial],
    flow.states,
    (name) => rootTransitionsOf(nodes, name),
    rootOf,
  )

  return [
    ...unreachable(flow.states, root).map((name) =>
      inScreens([...at, 'states', name], `is not reachable from "${flow.initial}"`),
    ),
    ...nodes.flatMap((node) => {
      if (node.kind !== 'region') {
        return []
      }

      const { initial, states } = node.state
      const reached = reachedFrom(
        [initial, ...Object.keys(states).filter((name) => deep.has(`${node.path}.${name}`))],
        states,
        (name) => {
          const state = states[name]

          return state === undefined ? [] : transitionsOf(state)
        },
        (target) => target,
      )

      return unreachable(states, reached).map((name) =>
        inScreens([...at, ...node.at, 'states', name], `is not reachable from "${initial}"`),
      )
    }),
  ]
}

const isStuck = (node: FlowNode): boolean =>
  (node.kind === 'root' || node.kind === 'region-state') &&
  !(node.kind === 'root' && node.state.type === 'final') &&
  Object.keys(node.state.on ?? {}).length === 0 &&
  node.state.invoke === undefined

export const stuckProblems = ({ flow, at, inScreens }: InFlow): Problem[] =>
  flowNodes(flow)
    .filter(isStuck)
    .map((node) =>
      inScreens([...at, ...node.at], 'is not final and has no event or invoke to leave it'),
    )
