/**
 * Which anchors each state renders, `meta.renders`: an anchor that no state of the flow lists
 * is rendered in every state; one that a state lists is rendered only where it is listed: in
 * a plain state of the root that lists it, and in a state of a region that lists it or whose
 * parallel state does. Each name is an anchor the flow's own screen declares (a derived part
 * is rendered with its base, which the list names instead), listed once. A plain state of the
 * root or a state of a region that handles an event on an anchor rendered only where listed
 * (on a derived part, through its base) renders that anchor, as a control the user acts on is
 * on the page; the events of a parallel state's own `on` are not held to it.
 */

import { baseOf } from '../../anchors'
import type { Flow, FlowNode, Problem, RegionStateNode, RootNode } from '../../files'
import { flowNodes } from '../../files'
import { own } from '../contract'

import type { At, InFlow } from './in-flow'

type StateNode = Exclude<FlowNode, { kind: 'region' }>

const listedBy = (node: StateNode): readonly string[] => node.state.meta?.renders ?? []

/** Each name of one list: an anchor the screen declares, not a part derived from one, once. */
function listProblems(
  { screen, contract, known, inScreens }: InFlow,
  names: readonly string[],
  at: At,
): Problem[] {
  const suffixes = Object.keys(contract.vocabulary.suffixes)

  return names.flatMap((name, index) => {
    const where = [...at, index]

    if (names.indexOf(name) < index) {
      return [inScreens(where, `"${name}" is already listed`)]
    }

    if (own(screen.anchors, name) !== undefined) {
      return []
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

/** The anchors rendered only where listed that `node` renders: its list, and its parallel state's. */
function renderedBy(flow: Flow, node: RootNode | RegionStateNode): ReadonlySet<string> {
  const parallel = node.kind === 'region-state' ? own(flow.states, node.parallel) : undefined

  return new Set([...(parallel?.meta?.renders ?? []), ...listedBy(node)])
}

/** Each event `node` handles on an anchor rendered only where listed: the node renders it. */
function unrenderedProblems(
  inFlow: InFlow,
  node: RootNode | RegionStateNode,
  conditional: ReadonlySet<string>,
): Problem[] {
  const suffixes = Object.keys(inFlow.contract.vocabulary.suffixes)
  const rendered = renderedBy(inFlow.flow, node)

  return Object.keys(node.state.on ?? {}).flatMap((event) => {
    const anchor = conditional.has(event) ? event : baseOf(event, suffixes)

    if (anchor === undefined || !conditional.has(anchor) || rendered.has(anchor)) {
      return []
    }

    const handled =
      anchor === event
        ? `"${event}" is handled here but not rendered`
        : `"${event}" is handled here but its base "${anchor}" is not rendered`

    return [
      inFlow.inScreens(
        [...inFlow.at, ...node.at, 'on', event],
        `${handled}: only the states that list it in meta.renders render it`,
      ),
    ]
  })
}

export function rendersProblems(inFlow: InFlow): Problem[] {
  const nodes = flowNodes(inFlow.flow).filter((node): node is StateNode => node.kind !== 'region')
  const conditional = new Set(
    nodes.flatMap(listedBy).filter((anchor) => own(inFlow.screen.anchors, anchor) !== undefined),
  )

  return nodes.flatMap((node) => [
    ...listProblems(inFlow, listedBy(node), [...inFlow.at, ...node.at, 'meta', 'renders']),
    ...(node.kind === 'parallel' ? [] : unrenderedProblems(inFlow, node, conditional)),
  ])
}
