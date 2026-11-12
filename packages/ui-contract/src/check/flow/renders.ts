/**
 * Which anchors each state renders, `meta.renders`: an anchor that no state of the flow lists
 * is rendered in every state; one that a state lists is rendered only where it is listed: in
 * a plain state of the root that lists it, and in a state of a region that lists it or whose
 * parallel state does. A listed anchor renders with it every anchor nested under it
 * (`<anchor>.<rest>`, as an anchor carries what is under it): the declared anchors whose ids
 * start with it, a composite's items under its list, and its derived parts. A declared anchor
 * nested under a listed one is rendered only where its container is, or where it is listed
 * itself. Each name is an anchor the flow's own screen declares (a derived part is rendered
 * with its base, which the list names instead), listed once, and never in the same list as an
 * anchor it is nested under. A plain state of the root or a state of a region that handles an
 * event on an anchor rendered only where listed (a nested anchor or a derived part through
 * what it is nested under) renders that anchor, as a control the user acts on is on the page;
 * the events of a parallel state's own `on` are not held to it.
 */

import { baseOf, isUnder } from '../../anchors'
import type { Flow, FlowNode, Problem, RegionStateNode, RootNode } from '../../files'
import { flowNodes } from '../../files'
import { own } from '../contract'

import type { At, InFlow } from './in-flow'

type StateNode = Exclude<FlowNode, { kind: 'region' }>

const listedBy = (node: StateNode): readonly string[] => node.state.meta?.renders ?? []

/** The names of `listed` that `anchor` is or is nested under, the outermost first. */
const containersOf = (listed: Iterable<string>, anchor: string): string[] =>
  [...listed].filter((name) => isUnder(name, anchor)).sort((a, b) => a.length - b.length)

/**
 * Each name of one list: an anchor the screen declares, not a part derived from one, once,
 * and not nested under another name of the list, which renders it already.
 */
function listProblems(
  { screen, contract, known, inScreens }: InFlow,
  names: readonly string[],
  at: At,
): Problem[] {
  const suffixes = Object.keys(contract.vocabulary.suffixes)
  const declared = names.filter((name) => own(screen.anchors, name) !== undefined)

  return names.flatMap((name, index) => {
    const where = [...at, index]

    if (names.indexOf(name) < index) {
      return [inScreens(where, `"${name}" is already listed`)]
    }

    if (own(screen.anchors, name) !== undefined) {
      const [container] = containersOf(declared, name).filter((other) => other !== name)

      return container === undefined
        ? []
        : [
            inScreens(
              where,
              `"${name}" is nested under "${container}", listed here too, which renders it already`,
            ),
          ]
    }

    const base = baseOf(name, suffixes)

    return base !== undefined && known(name) && own(screen.anchors, base) !== undefined
      ? [
          inScreens(
            where,
            `"${name}" is a part derived from "${base}": a state lists the base, which renders its parts`,
          ),
        ]
      : [inScreens(where, `"${name}" is not a declared anchor of the screen`)]
  })
}

/** The names `node` renders beyond the base set: its list, and its parallel state's. */
function renderedBy(flow: Flow, node: RootNode | RegionStateNode): ReadonlySet<string> {
  const parallel = node.kind === 'region-state' ? own(flow.states, node.parallel) : undefined

  return new Set([...(parallel?.meta?.renders ?? []), ...listedBy(node)])
}

/**
 * Each event `node` handles on an anchor rendered only where listed: the node renders it, by
 * listing it or an anchor it is nested under.
 */
function unrenderedProblems(
  inFlow: InFlow,
  node: RootNode | RegionStateNode,
  listed: ReadonlySet<string>,
): Problem[] {
  const rendered = renderedBy(inFlow.flow, node)

  return Object.keys(node.state.on ?? {}).flatMap((event) => {
    const containers = containersOf(listed, event)

    if (containers.length === 0 || containers.some((name) => rendered.has(name))) {
      return []
    }

    const which =
      containers.length === 1 && containers[0] === event
        ? 'it'
        : containers.map((name) => `"${name}"`).join(' or ')

    return [
      inFlow.inScreens(
        [...inFlow.at, ...node.at, 'on', event],
        `"${event}" is handled here but not rendered: only the states that list ${which} in meta.renders render it`,
      ),
    ]
  })
}

export function rendersProblems(inFlow: InFlow): Problem[] {
  const nodes = flowNodes(inFlow.flow).filter((node): node is StateNode => node.kind !== 'region')
  const listed = new Set(
    nodes.flatMap(listedBy).filter((anchor) => own(inFlow.screen.anchors, anchor) !== undefined),
  )

  return nodes.flatMap((node) => [
    ...listProblems(inFlow, listedBy(node), [...inFlow.at, ...node.at, 'meta', 'renders']),
    ...(node.kind === 'parallel' ? [] : unrenderedProblems(inFlow, node, listed)),
  ])
}
