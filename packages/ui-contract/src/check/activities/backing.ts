/**
 * What backs a transition of an activity in the screens: the flow of the anchor's screen,
 * from a transition on that anchor in any state of it (a parallel state's own `on` and the
 * states of its regions included), reaches a `navigate` to the target's path, or the anchor
 * is a link to that path (`binding.route`). A transition reaches the effects XState runs on
 * it: its actions; on a move, the exit of its state and the entry of its target, then what
 * follows the target's invoke (`onDone` and `onError`); a move into a parallel state enters
 * it and each region at its starting state (the one a deep target names, else the initial);
 * an id target out of a region leaves its parallel state for the state of the root it names.
 * Each state is followed once.
 */

import type { AnchorDef, Effect, Flow, FlowTransition, Screen } from '../../files'
import { bindingRefsOf, own } from '../contract'
import {
  type FlowNode,
  flowNodes,
  idTargetOf,
  type ParallelNode,
  type RegionStateNode,
  type RootNode,
  regionStartsOf,
  rootOf,
} from '../flow'

/** A transition or a guarded list of them, as a list. */
export const listOf = <T>(transitions: T | T[]): readonly T[] =>
  Array.isArray(transitions) ? transitions : [transitions]

/** A state that takes transitions: of the root, plain or parallel, or of a region. */
type Acting = RootNode | ParallelNode | RegionStateNode

const isActing = (node: FlowNode): node is Acting => node.kind !== 'region'

/** The paths a flow navigates to after a transition on `anchor`, each state followed once. */
function navigatesAfter(flow: Flow, anchor: string): Set<string> {
  const paths = new Set<string>()
  const seen = new Set<string>()
  const nodes = new Map(flowNodes(flow).map((node) => [node.path, node]))
  const collect = (effects: readonly Effect[] | undefined): void => {
    for (const effect of effects ?? []) {
      if (effect.type === 'navigate') {
        paths.add(effect.params.to)
      }
    }
  }
  /** Into a plain state, of the root or of a region: its entry, then its invoke's outcomes. */
  const enter = (path: string): void => {
    const node = nodes.get(path)

    if (seen.has(path) || (node?.kind !== 'root' && node?.kind !== 'region-state')) {
      return
    }

    const { entry, invoke } = node.state

    seen.add(path)
    collect(entry)

    for (const outcome of invoke === undefined
      ? []
      : [...listOf(invoke.onDone), ...listOf(invoke.onError ?? [])]) {
      follow(node, outcome)
    }
  }
  /** Each region of a parallel state at the state it starts in on a move to `target`. */
  const enterRegions = (parallel: ParallelNode, target: string): void => {
    for (const [region, start] of regionStartsOf(parallel.state, target)) {
      enter(`${parallel.name}.${region}.${start}`)
    }
  }
  /** Into a state of the root by a transition of the root: a parallel one with its regions. */
  const enterRoot = (target: string): void => {
    const node = nodes.get(rootOf(target))

    if (node?.kind === 'parallel') {
      collect(node.state.entry)
      enterRegions(node, target)
    } else {
      enter(rootOf(target))
    }
  }
  /** Out of `from`: the actions, and on a move the exit of `from` and the target's entry. */
  const follow = (from: Acting, { target, actions }: FlowTransition): void => {
    collect(actions)

    if (target === undefined || target === from.name) {
      return
    }

    if (from.kind === 'region-state') {
      const id = idTargetOf(target)
      const parallel = nodes.get(from.parallel)

      collect(from.state.exit)

      if (id === undefined) {
        enter(`${from.parallel}.${from.region}.${target}`)
      } else {
        // Out of the parallel state by the machine's id: its own exit, then the state of the
        // root entered anew, even its own; the other regions' active states are unknown.
        collect(parallel?.kind === 'parallel' ? parallel.state.exit : undefined)
        enterRoot(id.state)
      }
    } else if (from.kind === 'parallel' && rootOf(target) === from.name) {
      // Into itself, XState leaves and enters its regions' states only; the active ones are
      // unknown, so no exit is taken, and each region enters its starting state.
      enterRegions(from, target)
    } else {
      // Out of a parallel state, its own exit only: the regions' active states are unknown.
      collect(from.state.exit)
      enterRoot(target)
    }
  }

  for (const node of [...nodes.values()].filter(isActing)) {
    for (const transition of listOf(own(node.state.on ?? {}, anchor) ?? [])) {
      follow(node, transition)
    }
  }

  return paths
}

/**
 * An event of the state's screen or of the frame: the anchor, the screen that declares it (or
 * its base) and its declaration, when the anchor is declared rather than derived.
 */
export interface Backing {
  readonly anchor: string
  readonly owner: Screen
  readonly def: AnchorDef | undefined
}

/** Whether the screens take acting on the anchor to `path`: a flow's navigate, or a link. */
export function backed({ anchor, owner, def }: Backing, path: string): boolean {
  const linked =
    def !== undefined && bindingRefsOf(def).some(({ ref }) => 'route' in ref && ref.route === path)

  return linked || (owner.flow !== undefined && navigatesAfter(owner.flow, anchor).has(path))
}
