/**
 * The request pattern, filled on every invoke that writes no `onError` and whose action fails
 * with codes: on entry the error of the part is cleared (unless the state's `entry` clears it
 * already), and the failure shows its codes on that error on the one way back
 * (`files/derive/requests.ts`). An `onError` written as its target alone keeps the default
 * show; one with actions, or a guarded list, wins entirely. An action that fails with no code
 * gets nothing. A state with codes to show and no single way back is an issue at its invoke.
 */

import { listOf, recordOf } from '../../records'
import { failureCodes, isBare, requestsOf } from '../derive'

import type { Expansion } from './expansion'

const clearOf = (anchor: string) => ({ type: 'clear', params: { anchor } })
const showOf = (anchor: string, codes: readonly string[]) => ({
  type: 'show',
  params: { anchor, codes: [...codes] },
})

const clears = (effect: unknown, anchor: string): boolean =>
  recordOf(effect)['type'] === 'clear' && recordOf(recordOf(effect)['params'])['anchor'] === anchor

/** `states` with the state at `names` (a region's state through its region) replaced by `update(state)`. */
function updatedAt(
  states: Readonly<Record<string, unknown>>,
  names: readonly string[],
  update: (state: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const [name, ...rest] = names

  if (name === undefined) {
    return states
  }

  const state = recordOf(states[name])

  return {
    ...states,
    [name]:
      rest.length === 0
        ? update(state)
        : { ...state, states: updatedAt(recordOf(state['states']), rest, update) },
  }
}

/**
 * `states` (the flow's, expanded) with the request pattern on each invoke it fits, the issues
 * pushed on `expansion`; `at` is where the flow sits in its file.
 */
export function withDefaultOutcomes(
  states: Readonly<Record<string, unknown>>,
  expansion: Expansion,
  at: readonly PropertyKey[],
): Readonly<Record<string, unknown>> {
  const declared = (anchor: string): boolean => expansion.codesOf(anchor) !== undefined
  let out = states

  for (const request of requestsOf({ states }, expansion.screen, declared)) {
    const codes = failureCodes(expansion.failureOf(request.src))
    const { onError, fallback } = request

    // Nothing to show, or an onError with actions or a guarded list: written wins entirely.
    if (codes.length === 0 || (onError !== undefined && !isBare(onError))) {
      continue
    }

    if ('why' in fallback) {
      // A bare written target stays as written: the screen chose where to go, and no part has an error to show.
      if (onError === undefined) {
        expansion.issues.push({
          at: [...at, ...request.at, 'invoke', 'onError'],
          message: `${request.src} fails with ${codes.join(', ')} and the state writes no onError: ${fallback.why}; write its onError`,
        })
      }

      continue
    }

    const { back, error } = fallback
    const show = showOf(error, codes)

    out = updatedAt(out, request.names, (state) => {
      const invoke = recordOf(state['invoke'])

      if (onError !== undefined) {
        // A target alone keeps the default show (`stateOf` made a string target `{ target }` already).
        const target = typeof onError === 'string' ? { target: onError } : recordOf(onError)

        return { ...state, invoke: { ...invoke, onError: { ...target, actions: [show] } } }
      }

      const entry = listOf(state['entry'])

      return {
        ...state,
        entry: entry.some((effect) => clears(effect, error))
          ? [...entry]
          : [clearOf(error), ...entry],
        invoke: { ...invoke, onError: { target: back, actions: [show] } },
      }
    })
  }

  return out
}
