/**
 * The questions before destructive actions: a control whose binding names a destructive action
 * (`confirmations.ts`, any of its bindings when it has several) asks the frame's confirmation,
 * and carries `asks: { dialog, code }`, unless its anchor writes `confirm: false`, the one ban,
 * which the loader takes away (the canonical anchor does not know it). A ban on a control that
 * destroys nothing, and an `asks` a file writes itself, are problems of its file, the written
 * `asks` taken away. Without a confirmation on the frame nothing asks. The confirmation then
 * carries every code asked with: its codes are derived only.
 */

import { entriesOf, isRecord, listOf } from '../../records'
import { jsonPath, type Problem } from '../problems'

import { questionCodeOf } from './confirmations'

/** A question the loader derived: the frame's confirmation, its code, the action it asks before. */
export interface DerivedQuestion {
  readonly anchor: string
  readonly code: string
  readonly action: string
}

/** The first action of the anchor's bindings that destroys, with its code. */
function destroyedBy(
  def: Readonly<Record<string, unknown>>,
): Omit<DerivedQuestion, 'anchor'> | undefined {
  for (const ref of listOf(def['binding'])) {
    const action = isRecord(ref) ? ref['action'] : undefined
    const code = typeof action === 'string' ? questionCodeOf(action) : undefined

    if (typeof action === 'string' && code !== undefined) {
      return { code, action }
    }
  }

  return undefined
}

/**
 * `screen` as read, each control of a destructive action asking `dialog` (none without one), and
 * the questions it asks, with the problems of the bans that ban nothing.
 */
export function withDerivedQuestions(
  file: string,
  screen: unknown,
  dialog: string | undefined,
): { value: unknown; questions: DerivedQuestion[]; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return { value: screen, questions: [], problems: [] }
  }

  const questions: DerivedQuestion[] = []
  const problems: Problem[] = []
  const derived = entriesOf(anchors).map(([name, def]): [string, unknown] => {
    if (!isRecord(def)) {
      return [name, def]
    }

    const { asks: written, ...authored } = def

    if (written !== undefined) {
      problems.push({
        file,
        message: `${jsonPath(['anchors', name, 'asks'])}: asks is derived from the control's action: a screen file never writes it`,
      })
    }

    const { confirm, ...rest } = authored
    const destroyed = destroyedBy(authored)

    if (confirm === false) {
      if (destroyed === undefined) {
        problems.push({
          file,
          message: `${jsonPath(['anchors', name, 'confirm'])}: confirm: false bans no question: the control runs no destructive action`,
        })
      }

      return [name, rest]
    }

    // Any other `confirm` value stays for the canonical schema to refuse.
    if (confirm !== undefined || destroyed === undefined || dialog === undefined) {
      return [name, authored]
    }

    questions.push({ anchor: dialog, ...destroyed })

    return [name, { ...authored, asks: { dialog, code: destroyed.code } }]
  })

  return { value: { ...screen, anchors: Object.fromEntries(derived) }, questions, problems }
}

/**
 * `screen` as read, its anchor `dialog` carrying `codes` in place of any it writes (the loader
 * reports a written list: the confirmation's codes are derived only).
 */
export function withQuestionCodes(
  screen: unknown,
  dialog: string,
  codes: readonly string[],
): unknown {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined
  const def = isRecord(anchors) ? anchors[dialog] : undefined

  if (!isRecord(screen) || !isRecord(anchors) || !isRecord(def) || codes.length === 0) {
    return screen
  }

  return { ...screen, anchors: { ...anchors, [dialog]: { ...def, codes: [...codes] } } }
}
