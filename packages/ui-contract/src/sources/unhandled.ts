/**
 * Where a flow leaves a control it renders unhandled: a state the machine can be in that renders
 * an event's anchor (`meta.renders`, `isRendered`) and does not handle the event, which the app
 * then disables (`facets.ts`).
 */

import { isRendered, listedBy } from '../anchors'
import type { FlowNode, RegionStateNode } from '../files'

/** A state of a flow: of the root, plain or parallel, or of a region. */
type StateNode = Exclude<FlowNode, { kind: 'region' }>

/**
 * A state the machine can be in that renders `event` and does not handle it, by its path: a plain
 * state of the root, or a parallel state with one state of each of its regions. A parallel state
 * whose own `on` handles it, or one of whose regions handles it in every state, handles it in each;
 * otherwise a state of a region that does not handle it, with the others in one that does not
 * either, renders it where it or its parallel state lists it, or where no state lists it.
 */
export function unhandledWhere(nodes: readonly FlowNode[], event: string): string | undefined {
  const states = nodes.filter((node): node is StateNode => node.kind !== 'region')
  const regionStates = states.filter(
    (node): node is RegionStateNode => node.kind === 'region-state',
  )
  const listed = states.flatMap((node) => listedBy(node.state))
  const handles = (node: StateNode): boolean => Object.hasOwn(node.state.on ?? {}, event)
  const renders = (...active: readonly StateNode[]): boolean =>
    isRendered({ listed, rendered: active.flatMap((node) => listedBy(node.state)) }, event)

  for (const node of states) {
    if (node.kind === 'root' && !handles(node) && renders(node)) {
      return node.path
    }

    if (node.kind === 'parallel' && !handles(node)) {
      const unhandled = regionStates.filter(
        (other) => other.parallel === node.name && !handles(other),
      )
      const everyRegion = Object.keys(node.state.states).every((region) =>
        unhandled.some((other) => other.region === region),
      )
      const found = everyRegion ? unhandled.find((other) => renders(node, other)) : undefined

      if (found !== undefined) {
        return found.path
      }
    }
  }

  return undefined
}
