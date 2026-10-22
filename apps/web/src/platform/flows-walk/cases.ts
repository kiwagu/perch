/**
 * What the flow expects of each case of the walk: whether XState counts the transition as
 * handled (it moves or runs an action, as `snapshot.can` reads it), the configuration it lands
 * in (a `StateValue`: the name of a state of the root, or for a parallel state the state each
 * region is in) and the effects in XState's order. On a move, XState exits what it leaves, a
 * region's state before its parallel state and the last region first, runs the transition's
 * actions, then enters in the order of the file: a parallel state, then each region at its
 * starting state (the one a deep target names, else the initial). A transition without a
 * target, or of a plain state to itself, neither exits nor enters; a parallel state's own
 * transition into itself, by name or by a deep target, exits and enters only its regions'
 * states; an id target out of a region's state leaves the parallel state, every region's state
 * and then the parallel state itself, for the state of the root it names, entered anew even
 * when it is that parallel state. A case is sent from where the walk is: a state of the root; a
 * parallel state with every region at its initial; a region's state with the other regions at
 * their initial.
 */

import type { StateValue } from 'xstate'

import {
  type Effect,
  type Flow,
  type FlowNode,
  type FlowParallelState,
  type FlowTransition,
  flowNodes,
  idTargetOf,
  type RegionNode,
  regionStartsOf,
  rootOf,
} from '@workspace/ui-contract'

/** What a transition comes to: whether XState takes one, the state after it, its effects. */
export interface Outcome {
  readonly handled: boolean
  readonly state: StateValue
  readonly effects: readonly unknown[]
}

/** One case of the walk: a branch of an event of a state, the guard that holds for it. */
export interface Case {
  /** `<path> <event>[<branch>]`: an anchor or a platform event, `onDone` or `onError`. */
  readonly label: string
  readonly event: string
  readonly holding: string | undefined
  readonly expected: Outcome
}

/** A state that takes transitions: of the root, plain or parallel, or of a region. */
type Acting = Exclude<FlowNode, RegionNode>

const listOf = (transitions: FlowTransition | FlowTransition[]): FlowTransition[] =>
  Array.isArray(transitions) ? transitions : [transitions]

function parallelOf(flow: Flow, name: string): FlowParallelState | undefined {
  const state = flow.states[name]

  return state?.type === 'parallel' ? state : undefined
}

/** The configuration a transition to `target` lands in, from the root or by an id target. */
export function landingOf(flow: Flow, target: string): StateValue {
  const name = rootOf(target)
  const parallel = parallelOf(flow, name)

  return parallel === undefined
    ? name
    : { [name]: Object.fromEntries(regionStartsOf(parallel, target)) }
}

/** The configuration of a parallel state with every region at its initial state. */
const initialValueOf = (flow: Flow, parallel: string): StateValue => landingOf(flow, parallel)

/** The entries of the regions' starting states on a move to `target`, in the order of the file. */
const regionEntriesOf = (parallel: FlowParallelState, target: string): Effect[] =>
  regionStartsOf(parallel, target).flatMap(
    ([region, state]) => parallel.states[region]?.states[state]?.entry ?? [],
  )

/**
 * The exits of the regions' states, the last region first: each at its initial, but the
 * region `moved` at the state the walk holds it in.
 */
const regionExitsOf = (
  parallel: FlowParallelState,
  moved?: { readonly region: string; readonly state: string },
): Effect[] =>
  Object.entries(parallel.states)
    .reverse()
    .flatMap(
      ([region, { initial, states }]) =>
        states[region === moved?.region ? moved.state : initial]?.exit ?? [],
    )

/** The entries on a move of the root to `target`: a parallel state's, then its regions'. */
function enteringOf(flow: Flow, target: string): Effect[] {
  const state = flow.states[rootOf(target)]

  return state?.type === 'parallel'
    ? [...(state.entry ?? []), ...regionEntriesOf(state, target)]
    : (state?.entry ?? [])
}

/** Where a transition of `node` lands, from where the walk sends it, and its effects. */
function expectedOf(
  flow: Flow,
  node: Acting,
  { target, actions = [] }: FlowTransition,
): Omit<Outcome, 'handled'> {
  const id = target === undefined ? undefined : idTargetOf(target)
  const parallel = node.kind === 'region-state' ? parallelOf(flow, node.parallel) : undefined

  if (node.kind === 'region-state' && id !== undefined && parallel !== undefined) {
    return {
      state: landingOf(flow, id.state),
      effects: [
        ...regionExitsOf(parallel, { region: node.region, state: node.name }),
        ...(parallel.exit ?? []),
        ...actions,
        ...enteringOf(flow, id.state),
      ],
    }
  }

  if (node.kind === 'region-state') {
    const at = (state: string) => landingOf(flow, `${node.parallel}.${node.region}.${state}`)

    return target === undefined || target === node.name
      ? { state: at(node.name), effects: actions }
      : {
          state: at(target),
          effects: [
            ...(node.state.exit ?? []),
            ...actions,
            ...(node.siblings[target]?.entry ?? []),
          ],
        }
  }

  if (node.kind === 'root') {
    return target === undefined || target === node.name
      ? { state: node.name, effects: actions }
      : {
          state: landingOf(flow, target),
          effects: [...(node.state.exit ?? []), ...actions, ...enteringOf(flow, target)],
        }
  }

  if (target === undefined) {
    return { state: initialValueOf(flow, node.name), effects: actions }
  }

  const exits = regionExitsOf(node.state)

  return {
    state: landingOf(flow, target),
    effects:
      rootOf(target) === node.name
        ? [...exits, ...actions, ...regionEntriesOf(node.state, target)]
        : [...exits, ...(node.state.exit ?? []), ...actions, ...enteringOf(flow, target)],
  }
}

/**
 * Whether XState counts the transition as handled, as `snapshot.can` does: it moves or runs an
 * action; one that does neither leaves the state as it is and reads as not handled.
 */
const isHandled = ({ target, actions = [] }: FlowTransition): boolean =>
  target !== undefined || actions.length > 0

/** Each branch of each event of a state, and none holding after a guarded last branch. */
export function casesOfNode(flow: Flow, node: FlowNode): Case[] {
  if (node.kind === 'region') {
    return []
  }

  const invoke = node.kind === 'parallel' ? undefined : node.state.invoke
  const events = [
    ...Object.entries(node.state.on ?? {}),
    ...(invoke === undefined ? [] : [['onDone', invoke.onDone] as const]),
    ...(invoke?.onError === undefined ? [] : [['onError', invoke.onError] as const]),
  ]
  const none = { handled: false, ...expectedOf(flow, node, {}), effects: [] }

  return events.flatMap(([event, transitions]) => {
    const list = listOf(transitions)

    return [
      ...list.map((branch, index) => ({
        label: `${node.path} ${event}[${index}]`,
        event,
        holding: branch.guard,
        expected: { handled: isHandled(branch), ...expectedOf(flow, node, branch) },
      })),
      ...(list.at(-1)?.guard === undefined
        ? []
        : [{ label: `${node.path} ${event}[none]`, event, holding: undefined, expected: none }]),
    ]
  })
}

/** Every case of the flow, whether the walk reaches its state or not. */
export const casesOfFlow = (flow: Flow): Case[] =>
  flowNodes(flow).flatMap((node) => casesOfNode(flow, node))
