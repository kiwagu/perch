/**
 * The request pattern, on every invoke whose action fails with codes and whose `onError` the flow
 * leaves out or writes as its target alone (`files/derive/requests.ts`):
 *
 * - none written: on entry the state clears the error its failure shows on (unless its `entry`
 *   clears it already), and the failure goes the one way back, showing its codes on that error;
 *   a state with no way back or no error is an issue at its invoke, naming every reason;
 * - a target alone: the target stays, and the failure shows its codes on the error; a state with
 *   no error is an issue at its `onError`.
 *
 * An `onError` with actions, or a guarded list, wins entirely; an action that fails with no code
 * gets nothing.
 */

import { listOf, recordOf } from '../../records'
import { failureCodes, isBare, type Request, requestsOf } from '../derive'

import type { Expansion } from './expansion'

type State = Readonly<Record<string, unknown>>

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
  update: (state: State) => State,
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

/** The update a request gets, or the reason it gets none, for a failure with `codes`. */
function outcomeOf(
  request: Request,
  codes: readonly string[],
): { update: (state: State) => State } | { why: string } {
  const failing = `${request.src} fails with ${codes.join(', ')}`
  const { onError, back, error } = request

  if (onError !== undefined) {
    if ('why' in error) {
      return { why: `${failing} and its onError shows them nowhere: ${error.why}; write its show` }
    }

    // A target alone keeps its target (`stateOf` made a string target `{ target }` already).
    const target = typeof onError === 'string' ? { target: onError } : recordOf(onError)
    const show = showOf(error.anchor, codes)

    return {
      update: (state) => ({
        ...state,
        invoke: { ...recordOf(state['invoke']), onError: { ...target, actions: [show] } },
      }),
    }
  }

  if ('why' in back || 'why' in error) {
    const whys = [back, error].flatMap((each) => ('why' in each ? [each.why] : []))

    return {
      why: `${failing} and the state writes no onError: ${whys.join('; ')}; write its onError`,
    }
  }

  const show = showOf(error.anchor, codes)

  return {
    update: (state) => {
      const entry = listOf(state['entry'])

      return {
        ...state,
        entry: entry.some((effect) => clears(effect, error.anchor))
          ? [...entry]
          : [clearOf(error.anchor), ...entry],
        invoke: {
          ...recordOf(state['invoke']),
          onError: { target: back.state, actions: [show] },
        },
      }
    },
  }
}

/**
 * The states of `flow` (expanded, with its `initial`) with the request pattern on each invoke it
 * fits, the issues pushed on `expansion`; `at` is where the flow sits in its file.
 */
export function withDefaultOutcomes(
  flow: Readonly<Record<string, unknown>>,
  expansion: Expansion,
  at: readonly PropertyKey[],
): Readonly<Record<string, unknown>> {
  const declared = (anchor: string): boolean => expansion.codesOf(anchor) !== undefined
  let out = recordOf(flow['states'])

  for (const request of requestsOf(flow, expansion.screen, declared)) {
    const codes = failureCodes(expansion.failureOf(request.src))

    // Nothing to show, or an onError with actions or a guarded list: written wins entirely.
    if (codes.length === 0 || (request.onError !== undefined && !isBare(request.onError))) {
      continue
    }

    const outcome = outcomeOf(request, codes)

    if ('why' in outcome) {
      expansion.issues.push({
        at: [...at, ...request.at, 'invoke', 'onError'],
        message: outcome.why,
      })
    } else {
      out = updatedAt(out, request.names, outcome.update)
    }
  }

  return out
}
