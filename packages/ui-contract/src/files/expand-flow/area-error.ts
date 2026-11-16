/**
 * The error of a button's area after a success, derived from version 5: the area of a button
 * bound to one action is its part, and its error `<part>.error`, when the screen declares it.
 * Every branch of the `onDone` of the button's region, derived or written `by: <button>`, that
 * neither shows nor clears that error starts with `clear: <part>.error`, so a success forgets the
 * error a refusal showed. A branch that clears it itself is a problem at that clear: it is
 * derived. A branch that shows on it stays as it is, and so does a region written in full. Before
 * version 5 the outcome stays as it is.
 */

import { isRecord, listOf, recordOf } from '../../records'
import type { Control } from '../derive'

import type { Expansion } from './expansion'
import { clearOf, clears } from './requests'

/** The version from which a button region's success clears its area's error, and a file never writes it. */
export const AREA_ERROR_EDITION = 5

const shows = (effect: unknown, anchor: string): boolean =>
  recordOf(effect)['type'] === 'show' && recordOf(recordOf(effect)['params'])['anchor'] === anchor

/**
 * `done`, the expanded `onDone` of the region of `control`, with the clear of its area's error
 * first on each branch that neither shows nor clears it, and a problem at each clear of it a
 * branch writes; `at` is where the written `onDone` sits in its file.
 */
export function withAreaErrorCleared(
  done: unknown,
  control: Control,
  expansion: Expansion,
  at: readonly PropertyKey[],
): unknown {
  const { error } = control

  if (expansion.edition < AREA_ERROR_EDITION || error === undefined) {
    return done
  }

  const branchOf = (branch: unknown, where: readonly PropertyKey[]): unknown => {
    // Actions written as anything but a list stay for the canonical schema to refuse.
    if (
      !isRecord(branch) ||
      (branch['actions'] !== undefined && !Array.isArray(branch['actions']))
    ) {
      return branch
    }

    const actions = listOf(branch['actions'])

    if (actions.some((effect) => shows(effect, error))) {
      return branch
    }

    const written = actions.flatMap((effect, index) => (clears(effect, error) ? [index] : []))

    for (const index of written) {
      expansion.issues.push({
        at: [...where, 'actions', index],
        message: `derived: a success clears its area's error, ${error}; leave it out`,
      })
    }

    return written.length > 0 ? branch : { ...branch, actions: [clearOf(error), ...actions] }
  }

  return Array.isArray(done)
    ? done.map((branch: unknown, index) => branchOf(branch, [...at, index]))
    : branchOf(done, at)
}
