/**
 * What a flow says of the reads of a list: a `read` names a list, section or table the flow's
 * own screen declares whose `source` is a platform action, which it reads again (one whose
 * source is an entity of the model follows the stored data as it changes, here or on another
 * device, and is never read; one with no source has nothing to read; never a
 * visibility-button, nor another screen's anchor), and an invoke that says `read: false`,
 * nothing reads after its action, reads in none of its outcomes.
 */

import { VISIBILITY_BUTTON } from '../../anchors'
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
