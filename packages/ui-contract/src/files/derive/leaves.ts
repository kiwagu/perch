/**
 * The question before a leave a control's flow makes. A `navigate` on the event of a control of
 * the flow's own screen that moves to another path than its screen's leaves the screen as a link
 * does, so while `unsavedInput.screen` is `question` the control asks the frame's leave question
 * before its event, as long as a field it loses holds unsaved input. It loses the fields of its
 * screen that hold input, but those the move carries in its search and the control itself. A move
 * after an action (an invoke's outcome) or on a platform or data event asks nothing: the action
 * took the input, or nobody started it here. The control carries `leaves: { dialog, loses }`,
 * which a screen file never writes (`withoutWrittenLeaves`). A control of the screen is an anchor
 * it declares or a part one of them derives (`<anchor>.<suffix>`, a paged list's `next-link` and
 * its size select's options); a derived part has no declaration to carry the question, so the
 * check refuses its leave. The frame has no path and leaves nothing; what a flow may not do with
 * its moves is the check's (`check/flow/leaves.ts`).
 */

import { SIZE_SELECT, sizeOptionOf, testIdFor } from '../../anchors'
import { entriesOf, isRecord } from '../../records'
import { flowNodes } from '../flow-nodes'
import { jsonPath, type Problem } from '../problems'
import type { Effect, FlowTransition, Platform, Screen } from '../screens'

type Policy = Platform['unsavedInput']

type Navigate = Extract<Effect, { type: 'navigate' }>

/** One branch of a control's event: where it is, its moves, and what it loses leaving its screen. */
export interface ControlMove {
  readonly control: string
  /** Where the branch is in the flow: `['states', 'sign-in', 'on', '<control>']`, then its index in a list. */
  readonly at: readonly PropertyKey[]
  readonly navigates: readonly Navigate[]
  /** The fields it loses when a move of it leaves the screen, in order; none when it stays. */
  readonly loses: readonly string[] | undefined
}

const isNavigate = (effect: Effect): effect is Navigate => effect.type === 'navigate'

/**
 * The controls of `screen`: the anchors it declares, the parts each derives, and the options of a
 * paged list's size select, which name the sizes it pages by.
 */
export const ownControlsOf = (screen: Screen): Set<string> =>
  new Set(
    Object.entries(screen.anchors).flatMap(([anchor, def]) => {
      const derived = def.derived ?? []

      return [
        anchor,
        ...derived.map((suffix) => testIdFor(anchor, suffix)),
        ...(derived.includes(SIZE_SELECT) ? [sizeOptionOf(anchor)] : []),
      ]
    }),
  )

/** The anchors of fields a move carries in its search. */
const carriedBy = (move: Navigate): string[] =>
  Object.values(move.params.search ?? {}).flatMap((value) =>
    typeof value === 'object' && 'anchor' in value ? [value.anchor] : [],
  )

/** Each branch of one transition or a list, with where it is. */
const branchesOf = (
  transitions: FlowTransition | FlowTransition[],
  at: readonly PropertyKey[],
): Array<{ readonly transition: FlowTransition; readonly at: readonly PropertyKey[] }> =>
  Array.isArray(transitions)
    ? transitions.map((transition, index) => ({ transition, at: [...at, index] }))
    : [{ transition: transitions, at }]

/**
 * Every branch of the events of the controls of `screen`'s own flow, each with its moves and what
 * it loses when one of them leaves the screen; none for the frame, which has no path.
 */
export function controlMovesOf(screen: Screen): ControlMove[] {
  const { flow, anchors, bindings } = screen

  if (flow === undefined || screen.frame === true) {
    return []
  }

  const paths = new Set(bindings.map(({ path }) => path))
  const controls = ownControlsOf(screen)
  const fields = Object.entries(anchors)
    .filter(([, def]) => def.holdsInput === true)
    .map(([anchor]) => anchor)

  return flowNodes(flow).flatMap((node) => {
    if (node.kind === 'region') {
      return []
    }

    return Object.entries(node.state.on ?? {})
      .filter(([event]) => controls.has(event))
      .flatMap(([control, transitions]) =>
        branchesOf(transitions, [...node.at, 'on', control]).map(({ transition, at }) => {
          const navigates = (transition.actions ?? []).filter(isNavigate)
          const leaving = navigates.find(({ params }) => !paths.has(params.to))
          const kept = new Set([control, ...(leaving === undefined ? [] : carriedBy(leaving))])

          return {
            control,
            at,
            navigates,
            loses:
              leaving === undefined ? undefined : fields.filter((field) => !kept.has(field)).sort(),
          }
        }),
      )
  })
}

/**
 * `screen` with each control whose event leaves it asking `policy`'s question, losing the fields
 * its branches lose (each once, in order); none when a change of screen never asks or the platform
 * declares no policy.
 */
export function withDerivedLeaves(screen: Screen, policy: Policy): Screen {
  if (policy === undefined || policy.screen !== 'question') {
    return screen
  }

  const losing = new Map<string, Set<string>>()

  for (const { control, loses } of controlMovesOf(screen)) {
    if (loses !== undefined) {
      losing.set(control, new Set([...(losing.get(control) ?? []), ...loses]))
    }
  }

  const anchors = Object.fromEntries(
    Object.entries(screen.anchors).map(([anchor, def]) => {
      const loses = [...(losing.get(anchor) ?? [])].sort()

      return [
        anchor,
        loses.length === 0 ? def : { ...def, leaves: { dialog: policy.question, loses } },
      ]
    }),
  )

  return losing.size === 0 ? screen : { ...screen, anchors }
}

/** `screen` as read, without the `leaves` a file writes on an anchor, with the problem of each. */
export function withoutWrittenLeaves(
  file: string,
  screen: unknown,
): { value: unknown; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return { value: screen, problems: [] }
  }

  const problems: Problem[] = []
  const kept = entriesOf(anchors).map(([name, def]): [string, unknown] => {
    if (!isRecord(def) || def['leaves'] === undefined) {
      return [name, def]
    }

    const { leaves: _written, ...rest } = def

    problems.push({
      file,
      message: `${jsonPath(['anchors', name, 'leaves'])}: leaves is derived from the control's flow: a screen file never writes it`,
    })

    return [name, rest]
  })

  return problems.length === 0
    ? { value: screen, problems }
    : { value: { ...screen, anchors: Object.fromEntries(kept) }, problems }
}
