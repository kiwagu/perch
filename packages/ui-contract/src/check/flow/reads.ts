/**
 * What a flow says of the reads of a list: a `read` names a list, section or table the flow's
 * own screen declares whose `source` is a platform action, which it reads again (any other kind
 * lists nothing; one whose source is an entity of the model follows the stored data as it
 * changes, here or on another device, and is never read; one with no source has nothing to
 * read; never a visibility-button, nor another screen's anchor); an invoke that says
 * `read: false`, nothing reads after its action, reads in none of its outcomes; and a branch
 * that says `read: false`, nothing reads after this outcome, is a branch of an invoke's `onDone`
 * or `onError` (never the transition of an event), reads nothing itself, and sits under no
 * invoke that says it already.
 */

import { LISTING_KINDS, VISIBILITY_BUTTON } from '../../anchors'
import type { FlowState, FlowTransition, Problem } from '../../files'
import { own } from '../contract'

import type { At, InFlow } from './in-flow'

/** What a read may name: each problem of a read that names something else says it. */
const READ_NAMES =
  'a read names a list of its own screen whose source is a platform action, which it reads again'

/** The anchor a read names, as the header says. */
export function readProblems(
  { screen, defs, visibilityButtons, inScreens }: InFlow,
  anchor: string,
  at: At,
): Problem[] {
  if (visibilityButtons.has(anchor)) {
    return [
      inScreens(at, `"${anchor}" is a ${VISIBILITY_BUTTON}, presentation only: ${READ_NAMES}`),
    ]
  }

  const def = own(screen.anchors, anchor)

  if (def === undefined) {
    return defs.has(anchor)
      ? [inScreens(at, `"${anchor}" is an anchor of another screen: ${READ_NAMES}`)]
      : [inScreens(at, `"${anchor}" is not a declared anchor`)]
  }

  if (!LISTING_KINDS.has(def.kind)) {
    return [inScreens(at, `"${anchor}" is a ${def.kind}, which lists nothing: ${READ_NAMES}`)]
  }

  if (def.source === undefined) {
    return [inScreens(at, `"${anchor}" is a ${def.kind} with no source: ${READ_NAMES}`)]
  }

  return 'entity' in def.source
    ? [
        inScreens(
          at,
          `"${anchor}" lists the entity ${def.source.entity}, which it follows as the stored data changes and never reads: ${READ_NAMES}`,
        ),
      ]
    : []
}

/** The anchors the reads among `transitions`' effects name, each with where its branch is. */
const readsIn = (
  transitions: FlowTransition | FlowTransition[] | undefined,
  head: string,
): Array<{ anchor: string; where: string }> => {
  const branches =
    transitions === undefined ? [] : Array.isArray(transitions) ? transitions : [transitions]

  return branches.flatMap((branch, index) =>
    (branch.actions ?? []).flatMap((effect) =>
      effect.type === 'read'
        ? [
            {
              anchor: effect.params.anchor,
              where: branches.length > 1 ? `${head}[${index}]` : head,
            },
          ]
        : [],
    ),
  )
}

/**
 * An invoke that says `read: false`, nothing reads after its action, and reads in one of its
 * outcomes says two things at once: refused at the `read` key, once per read.
 */
export function readOptOutProblems(
  { inScreens }: InFlow,
  invoke: NonNullable<FlowState['invoke']>,
  at: At,
): Problem[] {
  if (invoke.read !== false) {
    return []
  }

  return [...readsIn(invoke.onDone, 'onDone'), ...readsIn(invoke.onError, 'onError')].map(
    ({ anchor, where }) =>
      inScreens(
        [...at, 'read'],
        `says nothing reads after ${invoke.src}, and its ${where} reads "${anchor}": a read after the action, or read: false, never both`,
      ),
  )
}

type Transitions = FlowTransition | FlowTransition[]

/** Each transition of one or a list, with where it is; a single one is a branch of its own. */
const placed = (transitions: Transitions, at: At): Array<readonly [FlowTransition, At]> =>
  Array.isArray(transitions)
    ? transitions.map((transition, index) => [transition, [...at, index]] as const)
    : [[transitions, at] as const]

/** The branches among `transitions` that say `read: false`, each at its `read` key. */
const optedOut = (transitions: Transitions | undefined, at: At): At[] =>
  transitions === undefined
    ? []
    : placed(transitions, at).flatMap(([{ read }, where]) =>
        read === false ? [[...where, 'read']] : [],
      )

/** A transition of an event that says `read: false`: only an outcome of an action may. */
const misplacedProblems = (
  { inScreens }: InFlow,
  state: Pick<FlowState, 'on'>,
  at: At,
): Problem[] =>
  Object.entries(state.on ?? {}).flatMap(([event, transitions]) =>
    optedOut(transitions, [...at, 'on', event]).map((where) =>
      inScreens(
        where,
        "says nothing reads after it, which only an outcome of an action says: read: false sits on a branch of an invoke's onDone or onError",
      ),
    ),
  )

/**
 * A branch of an invoke's outcome that says `read: false` and reads itself says two things at
 * once, refused once per read; one under an invoke that says `read: false` of every outcome
 * says it twice, refused once.
 */
function outcomeProblems(
  { inScreens }: InFlow,
  invoke: NonNullable<FlowState['invoke']>,
  transitions: Transitions | undefined,
  at: At,
): Problem[] {
  if (transitions === undefined) {
    return []
  }

  return placed(transitions, at).flatMap(([branch, where]) => {
    if (branch.read !== false) {
      return []
    }

    const key = [...where, 'read']

    if (invoke.read === false) {
      return [
        inScreens(
          key,
          `says nothing reads after this outcome of ${invoke.src}, and the invoke says it of every outcome already: read: false on the invoke or on its branch, never both`,
        ),
      ]
    }

    return (branch.actions ?? []).flatMap((effect) =>
      effect.type === 'read'
        ? [
            inScreens(
              key,
              `says nothing reads after this outcome of ${invoke.src}, and the outcome reads "${effect.params.anchor}": a read after this outcome, or read: false, never both`,
            ),
          ]
        : [],
    )
  })
}

/**
 * A transition that says `read: false`, nothing reads after this outcome, as the header says:
 * on a branch of an invoke's `onDone` or `onError` only (a single outcome is a branch of its
 * own), reading nothing itself, under no invoke that says it already.
 */
export function branchReadOptOutProblems(
  inFlow: InFlow,
  state: Pick<FlowState, 'on' | 'invoke'>,
  at: At,
): Problem[] {
  const { invoke } = state

  return [
    ...misplacedProblems(inFlow, state, at),
    ...(invoke === undefined
      ? []
      : [
          ...outcomeProblems(inFlow, invoke, invoke.onDone, [...at, 'invoke', 'onDone']),
          ...outcomeProblems(inFlow, invoke, invoke.onError, [...at, 'invoke', 'onError']),
        ]),
  ]
}
