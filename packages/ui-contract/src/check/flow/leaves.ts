/**
 * What a flow may do with its moves, so that each says which leave it is, and the question a
 * control asks before one (`files/derive/leaves.ts`) holds wherever the control is acted on. A
 * navigate sits on a transition, never in an entry or an exit, where no control could ask before
 * it, and one transition moves the app once. A navigate on the event of an anchor names a control
 * of the flow's own screen, outside the frame, which has no path: a control's leave loses the
 * fields of its own screen. A control's move to a path of its own screen needs a screen of one
 * path: with several, whether it leaves depends on the one the screen is at. And a control whose
 * event leaves its screen leaves it in every branch of every state that handles it, losing the
 * same fields: its question is asked before its event, so it cannot depend on the state or a guard.
 */

import {
  type ControlMove,
  controlMovesOf,
  type Effect,
  type FlowTransition,
  flowNodes,
  jsonPath,
  type Problem,
} from '../../files'

import type { At, InFlow } from './in-flow'

/** Why a control's question cannot differ between the places that handle its event. */
const BEFORE = 'its question is asked before its event, so it cannot depend on the state or a guard'

const isAnchorEvent = (event: string): boolean =>
  !event.startsWith('platform.') && !event.startsWith('model.')

/** The navigates among `effects`, each with its index. */
const navigatesIn = (
  effects: readonly Effect[] | undefined,
): Array<{ readonly effect: Extract<Effect, { type: 'navigate' }>; readonly index: number }> =>
  (effects ?? []).flatMap((effect, index) =>
    effect.type === 'navigate' ? [{ effect, index }] : [],
  )

/** Each branch of one transition or a list, with where it is. */
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

/** Every branch of the flow's transitions, with the event it handles; none for an outcome. */
function branchesOfFlow(
  inFlow: InFlow,
): Array<{ readonly transition: FlowTransition; readonly at: At; readonly event?: string }> {
  return flowNodes(inFlow.flow).flatMap((node) => {
    if (node.kind === 'region') {
      return []
    }

    const at = [...inFlow.at, ...node.at]
    const invoke = node.kind === 'parallel' ? undefined : node.state.invoke

    return [
      ...Object.entries(node.state.on ?? {}).flatMap(([event, transitions]) =>
        branchesOf(transitions, [...at, 'on', event]).map((branch) => ({ ...branch, event })),
      ),
      ...(invoke === undefined
        ? []
        : (['onDone', 'onError'] as const).flatMap((outcome) =>
            branchesOf(invoke[outcome], [...at, 'invoke', outcome]),
          )),
    ]
  })
}

/** A navigate in an entry or an exit, where its trigger, and so its leave, is unknown. */
function placeProblems(inFlow: InFlow): Problem[] {
  return flowNodes(inFlow.flow).flatMap((node) =>
    node.kind === 'region'
      ? []
      : (['entry', 'exit'] as const).flatMap((where) =>
          navigatesIn(node.state[where]).map(({ index }) =>
            inFlow.inScreens(
              [...inFlow.at, ...node.at, where, index],
              `a navigate sits on a transition, whose trigger says which leave it is: in an ${where} no control could ask before it`,
            ),
          ),
        ),
  )
}

/** What one branch's navigates may not do: move twice, or move on another screen's control. */
function branchProblems(inFlow: InFlow): Problem[] {
  const { screen, inScreens } = inFlow
  const paths = screen.bindings.map(({ path }) => path)

  return branchesOfFlow(inFlow).flatMap(({ transition, at, event }) =>
    navigatesIn(transition.actions).flatMap(({ effect, index }, nth) => {
      const here = [...at, 'actions', index]

      if (nth > 0) {
        return [
          inScreens(here, 'a transition moves the app once: a second navigate on it is refused'),
        ]
      }

      if (event === undefined || !isAnchorEvent(event)) {
        return []
      }

      if (screen.frame === true) {
        return [
          inScreens(
            here,
            `a navigate on the event of "${event}" in the frame: the frame has no path, so its control's leave cannot name the fields it loses`,
          ),
        ]
      }

      if (!Object.hasOwn(screen.anchors, event)) {
        return [
          inScreens(
            here,
            `a navigate on the event of "${event}", which this screen does not declare: a control's leave asks for the fields of its own screen`,
          ),
        ]
      }

      return paths.length > 1 && paths.includes(effect.params.to)
        ? [
            inScreens(
              here,
              `"${effect.params.to}" is a path of this screen, which has several: whether the move leaves it depends on the one it is at, which the control's question cannot say`,
            ),
          ]
        : []
    }),
  )
}

/** A control that leaves its screen in one place and not, or losing other fields, in another. */
function oneLeaveProblems(inFlow: InFlow): Problem[] {
  const byControl = new Map<string, ControlMove[]>()

  for (const move of controlMovesOf(inFlow.screen)) {
    byControl.set(move.control, [...(byControl.get(move.control) ?? []), move])
  }

  return [...byControl.entries()].flatMap(([control, moves]) => {
    const first = moves.find(({ loses }) => loses !== undefined)

    if (first?.loses === undefined) {
      return []
    }

    const where = jsonPath(['flow', ...first.at])
    const lost = JSON.stringify(first.loses)

    return moves.flatMap(({ at, loses }) => {
      if (loses === undefined) {
        return [
          inFlow.inScreens(
            [...inFlow.at, ...at],
            `"${control}" leaves its screen at ${where} and not here: ${BEFORE}`,
          ),
        ]
      }

      return JSON.stringify(loses) === lost
        ? []
        : [
            inFlow.inScreens(
              [...inFlow.at, ...at],
              `"${control}" loses other fields here than at ${where}: ${BEFORE}`,
            ),
          ]
    })
  })
}

/** The problems of the flow's moves as leaves: where they sit, whose control, one leave each. */
export function leaveProblems(inFlow: InFlow): Problem[] {
  return [...placeProblems(inFlow), ...branchProblems(inFlow), ...oneLeaveProblems(inFlow)]
}
