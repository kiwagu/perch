/**
 * The actions a screen runs with a search parameter of its route, `{ search: <name> }`: an
 * invoke's `input` (a region written `by` its button included, as the loader expands it) or a
 * list's source `params`. The key of an address is held to them (`check/keys.ts`) and a mail
 * link's key is derived from the first (`derive/mail-links.ts`), so both read the screen the same
 * way: the invokes of the flow's initial state first (the regions of a parallel initial state
 * included), so the first action is the one the screen starts with whatever order the file writes
 * its states in; then the invokes of the other states in the order of the file; then the sources.
 */

import { type FlowNode, flowNodes } from '../flow-nodes'
import type { Flow, ParamValue, Screen } from '../screens'

const PLATFORM = 'platform.'

/** An action the screen runs with a search parameter, and its parameter that takes it. */
export interface SearchTaker {
  readonly action: string
  readonly param: string
}

/** The parameters of `action` that `params` give the search parameter `name`. */
const takersIn = (
  action: string,
  params: Readonly<Record<string, ParamValue>> | undefined,
  name: string,
): SearchTaker[] =>
  Object.entries(params ?? {}).flatMap(([param, value]) =>
    typeof value === 'object' && 'search' in value && value.search === name
      ? [{ action, param }]
      : [],
  )

/** The invokes of `flow` that take `name`, those of its initial state first, then as the file writes them. */
function invokesTaking(flow: Flow, name: string): SearchTaker[] {
  const initial = (node: FlowNode): boolean =>
    node.kind === 'root'
      ? node.name === flow.initial
      : node.kind === 'region-state' && node.parallel === flow.initial
  const nodes = flowNodes(flow)

  return [...nodes.filter(initial), ...nodes.filter((node) => !initial(node))].flatMap((node) => {
    const invoke =
      node.kind === 'root' || node.kind === 'region-state' ? node.state.invoke : undefined

    return invoke === undefined ? [] : takersIn(invoke.src, invoke.input, name)
  })
}

/**
 * Each action `screen` runs with `{ search: <name> }`, its flow's invokes then its sources, each
 * parameter of an action once however many states run it.
 */
export function searchTakersOf(screen: Screen, name: string): SearchTaker[] {
  const invokes = screen.flow === undefined ? [] : invokesTaking(screen.flow, name)
  const sources = Object.values(screen.anchors).flatMap(({ source }) =>
    source !== undefined && 'platform' in source
      ? takersIn(`${PLATFORM}${source.platform}`, source.params, name)
      : [],
  )

  return [
    ...new Map(
      [...invokes, ...sources].map((taker) => [`${taker.action} ${taker.param}`, taker]),
    ).values(),
  ]
}
