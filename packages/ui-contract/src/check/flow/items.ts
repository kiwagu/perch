/**
 * Which event carries the data-id of an entry. A navigate whose search takes `{ item }` sits in
 * the actions of a transition on the event of a control in the entry's part, rendered in each
 * entry, never in an `entry`, an `exit` or the outcome of an invoke, where no entry was acted
 * on; an invoke whose input takes an entry runs in a state that only such events enter, never
 * one its area starts in or an invoke's outcome enters (`requestsOf` finds what enters it). What
 * the entry itself must be is `../entries.ts`'s; these hold an entry of the flow's own screen.
 */

import { ENTRY_KINDS } from '../../anchors'
import {
  type Effect,
  type FlowState,
  type FlowTransition,
  flowNodes,
  type Problem,
  type Request,
  requestsOf,
} from '../../files'
import { own } from '../contract'
import { carrierProblem, entryProblems, isEntry, unactedProblem } from '../entries'

import type { At, InFlow } from './in-flow'

interface Found {
  readonly item: string
  readonly at: At
}

/** Whether `item` is an entry the flow's own screen declares: an item or a row of it. */
const isOwnEntry = ({ screen }: InFlow, item: string): boolean =>
  ENTRY_KINDS.has(own(screen.anchors, item)?.kind ?? '')

/** The entries of its own screen whose data-id a navigate among `effects` takes, each at its path. */
function itemsIn(inFlow: InFlow, effects: readonly Effect[] | undefined, at: At): Found[] {
  return (effects ?? []).flatMap((effect, index) =>
    effect.type === 'navigate'
      ? Object.entries(effect.params.search ?? {}).flatMap(([key, value]) =>
          typeof value === 'object' && 'item' in value && isOwnEntry(inFlow, value.item)
            ? [{ item: value.item, at: [...at, index, 'params', 'search', key, 'item'] }]
            : [],
        )
      : [],
  )
}

/** Each transition of one or a list, with where it is: `on["x"]`, or `on["x"][1]` in a list. */
const branchesOf = (
  transitions: FlowTransition | FlowTransition[] | undefined,
  at: At,
): Array<{ readonly transition: FlowTransition; readonly at: At }> => {
  if (transitions === undefined) {
    return []
  }

  return Array.isArray(transitions)
    ? transitions.map((transition, index) => ({ transition, at: [...at, index] }))
    : [{ transition: transitions, at }]
}

/** The navigates of one state that take an entry's data-id, held to the event that carries it. */
function searchItemProblems(
  inFlow: InFlow,
  state: Pick<FlowState, 'entry' | 'exit' | 'on'> & { readonly invoke?: FlowState['invoke'] },
  at: At,
): Problem[] {
  const { screen, inScreens } = inFlow
  const unacted = (found: readonly Found[], where: string): Problem[] =>
    found.map(({ item, at: path }) => inScreens(path, unactedProblem(item, where)))
  const { invoke } = state

  return [
    ...unacted(itemsIn(inFlow, state.entry, [...at, 'entry']), 'in an entry'),
    ...unacted(itemsIn(inFlow, state.exit, [...at, 'exit']), 'in an exit'),
    ...Object.entries(state.on ?? {}).flatMap(([event, transitions]) =>
      branchesOf(transitions, [...at, 'on', event]).flatMap(({ transition, at: here }) =>
        itemsIn(inFlow, transition.actions, [...here, 'actions']).flatMap(({ item, at: path }) => {
          const problem = carrierProblem(screen, item, event, (what) => `on ${what}`)

          return problem === undefined ? [] : [inScreens(path, problem)]
        }),
      ),
    ),
    ...(invoke === undefined
      ? []
      : (['onDone', 'onError'] as const).flatMap((outcome) =>
          branchesOf(invoke[outcome], [...at, 'invoke', outcome]).flatMap(
            ({ transition, at: here }) =>
              unacted(
                itemsIn(inFlow, transition.actions, [...here, 'actions']),
                `in the ${outcome} of ${invoke.src}`,
              ),
          ),
        )),
  ]
}

/** Why the transitions entering `request`'s state cannot give the data-id of `item`, if any. */
function enteringProblems(inFlow: InFlow, request: Request, item: string): string[] {
  const problems = [
    ...(request.starts ? [unactedProblem(item, 'in a state its area starts in')] : []),
    ...request.entered.flatMap(({ from, event }) => {
      if (event === undefined) {
        return [unactedProblem(item, `in a state an outcome of "${from}" enters`)]
      }

      const problem = carrierProblem(
        inFlow.screen,
        item,
        event,
        (what) => `in a state entered on ${what}`,
      )

      return problem === undefined ? [] : [problem]
    }),
  ]

  return [...new Set(problems)]
}

/** The invokes whose input takes an entry's data-id: of its own screen, which a control enters. */
function inputItemProblems(inFlow: InFlow): Problem[] {
  const { flow, screen, known, inScreens } = inFlow
  const inputs = new Map(
    flowNodes(flow).flatMap((node) =>
      node.kind === 'root' || node.kind === 'region-state'
        ? [[JSON.stringify(node.at), node.state.invoke?.input] as const]
        : [],
    ),
  )

  return requestsOf(flow, screen.id, known).flatMap((request) =>
    Object.entries(inputs.get(JSON.stringify(request.at)) ?? {}).flatMap(([key, value]) => {
      if (typeof value !== 'string' || !isEntry(inFlow, value)) {
        return []
      }

      const at = [...inFlow.at, ...request.at, 'invoke', 'input', key]

      return [
        ...entryProblems(inFlow, value, 'a parameter', at),
        ...(isOwnEntry(inFlow, value)
          ? enteringProblems(inFlow, request, value).map((problem) => inScreens(at, problem))
          : []),
      ]
    }),
  )
}

/** The events that carry an entry's data-id into a navigate's search or an invoke's input. */
export function itemProblems(inFlow: InFlow): Problem[] {
  return [
    ...flowNodes(inFlow.flow).flatMap((node) =>
      node.kind === 'region'
        ? []
        : searchItemProblems(inFlow, node.state, [...inFlow.at, ...node.at]),
    ),
    ...inputItemProblems(inFlow),
  ]
}
