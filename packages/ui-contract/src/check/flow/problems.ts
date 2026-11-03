/**
 * Rule 8: a screen's flow is a machine XState runs as written, naming only what the
 * contract declares. A state of the root is a plain state or a parallel state whose regions
 * are the screen's independent areas (`files/flow-nodes.ts`). Its `initial` is a state of the flow and
 * a region's `initial` a state of that region; every `target` leads where XState resolves
 * it (`targets.ts`); every event, effect and address names what the contract declares
 * (`references.ts`); an `invoke` runs an action as a binding does (rule 3), its `input` keyed
 * by that action's parameters; every guard is declared in `meta.guards` and every declared
 * one is used, across the whole tree; every state is reachable and every plain state that is
 * not final has a way out (`reach.ts`); within a parallel state an event belongs to one area
 * (`areas.ts`); what a state renders names the screen's anchors, and a state renders the
 * anchors it handles (`renders.ts`).
 */

import type { FlowState, Problem } from '../../files'
import { type FlowNode, flowNodes, type RegionStateNode, transitionsOf } from '../../files'
import { type Contract, declaredAnchors, has } from '../contract'
import { actionProblems, lookupsOf, searchOf } from '../lookups'

import { areaProblems } from './areas'
import type { At, InFlow } from './in-flow'
import { stuckProblems, unreachableProblems } from './reach'
import { addressProblems, effectProblems, eventProblems } from './references'
import { rendersProblems } from './renders'
import { transitionsProblems } from './targets'

/** What a state of any kind may hold: a parallel state and a region state hold part of it. */
type StateParts = Pick<FlowState, 'meta' | 'entry' | 'exit' | 'on' | 'invoke'>

function stateProblems(
  inFlow: InFlow,
  state: StateParts,
  at: At,
  within: RegionStateNode | undefined,
): Problem[] {
  const { invoke } = state

  return [
    ...addressProblems(inFlow, state.meta?.address, [...at, 'meta', 'address']),
    ...effectProblems(inFlow, state.entry, [...at, 'entry']),
    ...effectProblems(inFlow, state.exit, [...at, 'exit']),
    ...Object.entries(state.on ?? {}).flatMap(([event, transitions]) => [
      ...eventProblems(inFlow, event, [...at, 'on', event]),
      ...transitionsProblems(inFlow, transitions, [...at, 'on', event], within),
    ]),
    ...(invoke === undefined
      ? []
      : [
          ...actionProblems(
            inFlow,
            invoke.src,
            invoke.input,
            { action: [...at, 'invoke', 'src'], params: [...at, 'invoke', 'input'] },
            searchOf(inFlow.screen),
          ),
          ...transitionsProblems(inFlow, invoke.onDone, [...at, 'invoke', 'onDone'], within),
          ...(invoke.onError === undefined
            ? []
            : transitionsProblems(inFlow, invoke.onError, [...at, 'invoke', 'onError'], within)),
        ]),
  ]
}

function nodeProblems(inFlow: InFlow, node: FlowNode): Problem[] {
  const at = [...inFlow.at, ...node.at]

  switch (node.kind) {
    case 'region': {
      const { initial, states } = node.state

      return has(states, initial)
        ? []
        : [
            inFlow.inScreens(
              [...at, 'initial'],
              `"${initial}" is not a state of region "${node.name}"`,
            ),
          ]
    }
    case 'region-state':
      return stateProblems(inFlow, node.state, at, node)
    default:
      return stateProblems(inFlow, node.state, at, undefined)
  }
}

function unusedGuardProblems({ flow, at, inScreens }: InFlow): Problem[] {
  const used = new Set(
    flowNodes(flow)
      .flatMap((node) => (node.kind === 'region' ? [] : transitionsOf(node.state)))
      .flatMap(({ guard }) => (guard === undefined ? [] : [guard])),
  )

  return Object.keys(flow.meta?.guards ?? {})
    .filter((guard) => !used.has(guard))
    .map((guard) =>
      inScreens([...at, 'meta', 'guards', guard], 'is declared but no transition uses it'),
    )
}

export function flowProblems(contract: Contract): Problem[] {
  const lookups = lookupsOf(contract)
  const defs = new Map(declaredAnchors(contract.screens).map(({ anchor, def }) => [anchor, def]))
  const bindings = new Map(
    contract.screens.screens.flatMap(({ bindings: of }) =>
      of.map((binding) => [binding.path, binding] as const),
    ),
  )

  return contract.screens.screens.flatMap((screen, index) => {
    const { flow } = screen

    if (flow === undefined) {
      return []
    }

    const inFlow: InFlow = {
      ...lookups,
      screen,
      flow,
      at: ['screens', index, 'flow'],
      defs,
      bindings,
    }

    return [
      ...(has(flow.states, flow.initial)
        ? []
        : [
            lookups.inScreens(
              [...inFlow.at, 'initial'],
              `"${flow.initial}" is not a state of the flow`,
            ),
          ]),
      ...flowNodes(flow).flatMap((node) => nodeProblems(inFlow, node)),
      ...areaProblems(inFlow),
      ...rendersProblems(inFlow),
      ...unusedGuardProblems(inFlow),
      ...unreachableProblems(inFlow),
      ...stuckProblems(inFlow),
    ]
  })
}
