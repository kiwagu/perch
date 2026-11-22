/**
 * How a platform action writes its codes and its result, read one way by every reader of the
 * engine. Its `codes` are a map from each code to the condition it answers on or to the invariant
 * it refuses for (`{ invariant: <name> }`), or, the older form, a list of their names. Its
 * `result` is one outcome or a list of outcome lines, the plain success first.
 */

import type { ActionCodes, ActionResult } from '../schemas'

/** One code of an action: its place in `codes` (its key, or its index in the older list). */
export interface CodeEntry {
  readonly code: string
  readonly at: string | number
  /** When the action answers with it, where the map writes a condition. */
  readonly condition?: string
  /** The invariant it refuses for, where the map names one. */
  readonly invariant?: string
}

/** The codes of an action by name, in the order it writes them. */
export const codeNamesOf = (codes: ActionCodes): readonly string[] =>
  Array.isArray(codes) ? codes : Object.keys(codes)

/** Each code of an action with its place, and its condition or invariant where it writes one. */
export function codeEntriesOf(codes: ActionCodes): readonly CodeEntry[] {
  if (Array.isArray(codes)) {
    return codes.map((code, index) => ({ code, at: index }))
  }

  return Object.entries(codes).map(([code, answer]) =>
    typeof answer === 'string'
      ? { code, at: code, condition: answer }
      : { code, at: code, invariant: answer.invariant },
  )
}

/** The outcome lines of an action: one outcome as a list of one. */
export const outcomesOf = (result: ActionResult): readonly string[] =>
  typeof result === 'string' ? [result] : result
