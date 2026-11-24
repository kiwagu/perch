/**
 * A pure walk of a screen's flow in XState (`machine.ts`): from every state of the root it
 * reaches, the walk sends, with `initialTransition` and `transition` only, each case of that
 * state (`cases.ts`): each event of `on`, each branch of a guarded list once with its own
 * guard holding and none before it (and, when the last branch is guarded too, once with none
 * holding), and an invoke's done and error events as XState raises them
 * (`xstate.done.actor.<id>` with its `output`, `xstate.error.actor.<id>` with its `error`, the
 * id the machine gives the invoke at that state's node). A parallel state is walked each
 * region on its own, the others at their initial state: from the configuration where every
 * region is at its initial, as XState resolves it, its own events are sent; then, per region,
 * a breadth-first walk from its initial state and the states a deep target of the root names
 * sends only the events of that region's current state, reaching the region's states by name;
 * a state of the root an id target leads to joins the walk of the root. A flow without a
 * parallel state, or an activity, walks flat. Each case says what the flow expects and what
 * XState did.
 */

import {
  type AnyEventObject,
  initialTransition,
  type SnapshotFrom,
  type StateValue,
  transition,
} from 'xstate'

import {
  deepEnteredOf,
  type Flow,
  type FlowNode,
  flowNodes,
  type ParallelNode,
  type RegionNode,
} from '../../files'

import { type Case, casesOfNode, landingOf, type Outcome } from './cases'
import { type Machine, machineOf } from './machine'

export interface Walked {
  /** The paths of the states the walk reached (`viewing`, `viewing.notes.adding`), in order. */
  readonly visited: readonly string[]
  readonly cases: ReadonlyArray<Case & { readonly actual: Outcome }>
}

type Snapshot = SnapshotFrom<Machine>

/** The event XState takes for a case: the anchor's or platform's, or the invoke's outcome. */
function eventOf(machine: Machine, path: string, event: string): AnyEventObject {
  const node = path
    .split('.')
    .reduce<Machine['root'] | undefined>((at, name) => at?.states[name], machine.root)
  const id = node?.invoke[0]?.id ?? `no invoke in ${path}`

  switch (event) {
    case 'onDone':
      return { type: `xstate.done.actor.${id}`, output: undefined, actorId: id }
    case 'onError':
      return {
        type: `xstate.error.actor.${id}`,
        error: new Error('the action failed'),
        actorId: id,
      }
    default:
      return { type: event }
  }
}

const isEffect = ({ type }: { readonly type: string }): boolean =>
  type === 'show' || type === 'clear' || type === 'read' || type === 'navigate'

/** The state of the root a configuration is in: its name, or the key of a parallel one. */
const rootOf = (value: StateValue): string =>
  typeof value === 'string' ? value : (Object.keys(value)[0] ?? '')

/** The state a region is in within a configuration of its parallel state. */
function regionStateOf(value: StateValue, parallel: string, region: string): string | undefined {
  const regions = typeof value === 'string' ? undefined : value[parallel]
  const state = regions === undefined || typeof regions === 'string' ? undefined : regions[region]

  return typeof state === 'string' ? state : undefined
}

export function walk(flow: Flow): Walked {
  const holds = new Set<string>()
  const machine = machineOf(flow, holds)
  const nodes = new Map(flowNodes(flow).map((node) => [node.path, node]))
  const deep = deepEnteredOf(flow)
  const [first] = initialTransition(machine)
  const reached = new Map<string, Snapshot>([[rootOf(first.value), first]])
  const visited: string[] = []
  const cases: Array<Case & { readonly actual: Outcome }> = []

  /** Sends each case of the node from `snapshot`, and gives the snapshot after each. */
  const send = (node: FlowNode, snapshot: Snapshot): Snapshot[] =>
    casesOfNode(flow, node).map((each) => {
      const event = eventOf(machine, node.path, each.event)

      holds.clear()

      if (each.holding !== undefined) {
        holds.add(each.holding)
      }

      const handled = snapshot.can(event)
      const [next, actions] = transition(machine, snapshot, event)
      const effects = actions.filter(isEffect).map(({ type, params }) => ({ type, params }))

      cases.push({ ...each, actual: { handled, state: next.value, effects } })

      return next
    })

  /** The configuration of a region's state, the other regions at their initial. */
  const resolved = (path: string): Snapshot =>
    machine.resolveState({ value: landingOf(flow, path) })

  /**
   * The states of a region, breadth first from its initial one and the ones a deep target of
   * the root names, the other regions at their initial; gives every snapshot it lands in, an
   * id target's out of the parallel state among them.
   */
  const walkRegion = (region: RegionNode, base: Snapshot): Snapshot[] => {
    const states = new Map<string, Snapshot>([[region.state.initial, base]])
    const landed: Snapshot[] = []

    for (const name of Object.keys(region.state.states)) {
      if (deep.has(`${region.path}.${name}`) && !states.has(name)) {
        states.set(name, resolved(`${region.path}.${name}`))
      }
    }

    visited.push(region.path)

    for (const [name, snapshot] of states) {
      const node = nodes.get(`${region.path}.${name}`)

      visited.push(`${region.path}.${name}`)

      for (const next of node === undefined ? [] : send(node, snapshot)) {
        const state = regionStateOf(next.value, region.parallel, region.name)

        landed.push(next)

        if (state !== undefined && !states.has(state)) {
          states.set(state, next)
        }
      }
    }

    return landed
  }

  /** Its own events from every region at its initial, then each region on its own. */
  const walkParallel = (parallel: ParallelNode): Snapshot[] => {
    const base = resolved(parallel.name)

    return [
      ...send(parallel, base),
      ...[...nodes.values()].flatMap((node) =>
        node.kind === 'region' && node.parallel === parallel.name ? walkRegion(node, base) : [],
      ),
    ]
  }

  for (const [name, snapshot] of reached) {
    const node = nodes.get(name)

    visited.push(name)

    const landed =
      node === undefined ? [] : node.kind === 'parallel' ? walkParallel(node) : send(node, snapshot)

    for (const next of landed) {
      if (!reached.has(rootOf(next.value))) {
        reached.set(rootOf(next.value), next)
      }
    }
  }

  return { visited, cases }
}
