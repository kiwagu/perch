/**
 * How a platform action writes its codes and its result, read one way by every reader of the
 * engine. Its `codes` are a map from each code to the condition it answers on, or to the invariants
 * it refuses for (`{ invariant: <name> }`, `{ invariant: [<name>, ...] }`), with a condition of its
 * own beside them when it has one; or, the older form a contract before version 6 may write, a list
 * of their names. Its
 * `result` is one outcome or a list of outcome lines, the plain success first.
 */

import type { ActionCodes, ActionResult } from '../schemas'

/** One code of an action: its place in `codes` (its key, or its index in the older list). */
export interface CodeEntry {
  readonly code: string
  readonly at: string | number
  /** When the action answers with it, where the map writes a condition (beside invariants or alone). */
  readonly condition?: string
  /** The invariants it refuses for, in the order the map names them; none where it names none. */
  readonly invariants: readonly string[]
}

/** The codes of an action by name, in the order it writes them. */
export const codeNamesOf = (codes: ActionCodes): readonly string[] =>
  Array.isArray(codes) ? codes : Object.keys(codes)

/** Each code of an action with its place, its invariants, and its condition where it writes one. */
export function codeEntriesOf(codes: ActionCodes): readonly CodeEntry[] {
  if (Array.isArray(codes)) {
    return codes.map((code, index) => ({ code, at: index, invariants: [] }))
  }

  return Object.entries(codes).map(([code, answer]): CodeEntry => {
    if (typeof answer === 'string') {
      return { code, at: code, condition: answer, invariants: [] }
    }

    const invariants = typeof answer.invariant === 'string' ? [answer.invariant] : answer.invariant

    return answer.condition === undefined
      ? { code, at: code, invariants }
      : { code, at: code, invariants, condition: answer.condition }
  })
}

/** The outcome lines of an action: one outcome as a list of one. */
export const outcomesOf = (result: ActionResult): readonly string[] =>
  typeof result === 'string' ? [result] : result
