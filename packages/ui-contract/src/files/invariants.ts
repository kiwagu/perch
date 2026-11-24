/**
 * The actions each invariant of the platform limits, derived: an action names an invariant under
 * the code it refuses with (`<code>: { invariant: <name> }`, or one of several,
 * `{ invariant: [<name>, ...] }`), and only there, so the list of the
 * actions an invariant limits is never written by hand and cannot leave a new action out.
 */

import { codeEntriesOf } from './action-codes'
import type { Platform } from './screens'

/**
 * Per invariant of `platform`, the actions that name it, each once, by name, so the order the
 * platform file writes its actions in changes nothing; an invariant no action names gets none.
 */
export function invariantActions(
  platform: Pick<Platform, 'actions' | 'invariants'>,
): Record<string, readonly string[]> {
  const actions = Object.entries(platform.actions)

  return Object.fromEntries(
    Object.keys(platform.invariants ?? {}).map((name) => [
      name,
      actions
        .filter(([, action]) =>
          codeEntriesOf(action.codes).some(({ invariants }) => invariants.includes(name)),
        )
        .map(([action]) => action)
        .sort((a, b) => a.localeCompare(b, 'en')),
    ]),
  )
}
