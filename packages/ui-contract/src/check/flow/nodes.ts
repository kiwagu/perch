/**
 * The states of a flow as one tree, the one walk every reader of a flow takes (rule 8, the
 * backing of rule 9, the routes view, the walk in XState): each state of the root, plain or
 * parallel; each region of a parallel state; each state of a region. A node carries its name,
 * its path of names as XState names the node under the machine (`viewing.note-items.editing`),
 * where it is in the flow (`states.viewing.states.note-items.states.editing`) and its kind;
 * a region state, its parallel state, its region and the states of that region. Then the
 * targets: a transition of the root names a state of the root or, as XState splits a target
 * on `.`, a state of a region as `<parallel>.<region>.<state>` (a deep target).
 */

import type {
  Flow,
  FlowParallelState,
  FlowRegion,
  FlowRegionState,
  FlowState,
  FlowTransition,
} from '../../files'

interface Placed {
  /** The key of the `states` that hold it. */
  readonly name: string
  /** Its names from the root, dotted: `viewing.note-items.editing`. */
  readonly path: string
  /** Where it is in the flow: `['states', 'viewing', 'states', 'note-items']`. */
  readonly at: readonly string[]
}

/** A plain state of the root. */
export interface RootNode extends Placed {
  readonly kind: 'root'
  readonly state: FlowState
}

/** A parallel state of the root. */
export interface ParallelNode extends Placed {
  readonly kind: 'parallel'
  readonly state: FlowParallelState
}

/** A region of a parallel state. */
export interface RegionNode extends Placed {
  readonly kind: 'region'
  readonly state: FlowRegion
  readonly parallel: string
}

/** A state of a region, with the states of its region: its targets are among them. */
export interface RegionStateNode extends Placed {
  readonly kind: 'region-state'
  readonly state: FlowRegionState
  readonly parallel: string
  readonly region: string
  readonly siblings: Readonly<Record<string, FlowRegionState>>
}

export type FlowNode = RootNode | ParallelNode | RegionNode | RegionStateNode

/** The regions of a parallel state, each followed by its states. */
function regionNodes(parallel: ParallelNode): FlowNode[] {
  return Object.entries(parallel.state.states).flatMap(([region, of]) => {
    const at = [...parallel.at, 'states', region]
    const path = `${parallel.path}.${region}`

    return [
      { kind: 'region', name: region, path, at, state: of, parallel: parallel.name } as const,
      ...Object.entries(of.states).map(
        ([name, state]) =>
          ({
            kind: 'region-state',
            name,
            path: `${path}.${name}`,
            at: [...at, 'states', name],
            state,
            parallel: parallel.name,
            region,
            siblings: of.states,
          }) as const,
      ),
    ]
  })
}

/** Every state of the flow, in the order of the file: a parallel state before its regions. */
export function flowNodes(flow: Flow): FlowNode[] {
  return Object.entries(flow.states).flatMap(([name, state]): FlowNode[] => {
    const placed = { name, path: name, at: ['states', name] }

    if (state.type !== 'parallel') {
      return [{ ...placed, kind: 'root', state }]
    }

    const parallel: ParallelNode = { ...placed, kind: 'parallel', state }

    return [parallel, ...regionNodes(parallel)]
  })
}

/** A transition or a guarded list of them, as a list. */
const listOf = (transitions: FlowTransition | FlowTransition[]): readonly FlowTransition[] =>
  Array.isArray(transitions) ? transitions : [transitions]

/** Every transition a state may take: on its events, and when its invoke ends. */
export const transitionsOf = (state: Pick<FlowState, 'on' | 'invoke'>): FlowTransition[] => [
  ...Object.values(state.on ?? {}).flatMap(listOf),
  ...(state.invoke === undefined
    ? []
    : [...listOf(state.invoke.onDone), ...listOf(state.invoke.onError ?? [])]),
]

/** A target of the root into a region: `<parallel>.<region>.<state>`. */
export interface DeepTarget {
  readonly parallel: string
  readonly region: string
  readonly state: string
}

/** The parts of a deep target, or undefined for the name of a state. */
export function deepTargetOf(target: string): DeepTarget | undefined {
  const [parallel, region, state, ...more] = target.split('.')

  return parallel === undefined || region === undefined || state === undefined || more.length > 0
    ? undefined
    : { parallel, region, state }
}

/** The state of the root a transition of the root to `target` lands in. */
export const rootOf = (target: string): string => deepTargetOf(target)?.parallel ?? target

/**
 * Per region of a parallel state that a transition of the root enters to `target`, the state
 * it starts in: the state a deep target names for its region, the initial one for the others.
 */
export function regionStartsOf(
  parallel: FlowParallelState,
  target: string,
): Array<readonly [string, string]> {
  const deep = deepTargetOf(target)

  return Object.entries(parallel.states).map(
    ([region, { initial }]) => [region, deep?.region === region ? deep.state : initial] as const,
  )
}
