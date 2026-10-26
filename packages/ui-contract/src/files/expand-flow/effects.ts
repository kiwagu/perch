/**
 * An effect and a transition as a screen file may author them, expanded into the forms XState
 * runs: `show: <anchor>` (one of the codes the anchor carries, in its order; in the `onError`
 * of an invoke, one of the codes the failure of its action shows), `show: { <anchor>: [codes]
 * }`, `clear: <anchor>`, `navigate: <path>` or `navigate: { to, search }` into `{ type, params
 * }`; a transition that is its target alone into `{ target }`. What is not one of these forms
 * is left as it is, for the canonical schema to judge. `failing` is the action whose failure
 * the transitions follow, in an `onError`.
 */

import { isRecord } from '../../records'

import type { Expansion } from './expansion'

/**
 * The codes `show: <anchor>` shows here, or why it shows none. While the file of the failing
 * action does not load, the anchor's own codes stand in, so that file's problems are the ones
 * reported.
 */
function shownBy(
  anchor: string,
  expansion: Expansion,
  failing: string | undefined,
): { codes: readonly string[] } | { why: string } {
  const carried = expansion.codesOf(anchor)
  const name = `name the ones it shows here: show: { ${anchor}: [<code>] }`

  if (carried === undefined) {
    return { why: `no screen declares the anchor ${anchor}` }
  }

  if (failing === undefined) {
    return carried.length > 0
      ? { codes: carried }
      : { why: `the anchor ${anchor} declares no codes; ${name}` }
  }

  const failure = expansion.failureOf(failing)

  if (failure === 'unloaded') {
    return { codes: carried.length > 0 ? carried : ['failed'] }
  }

  if (failure === undefined) {
    return {
      why: `${failing} is no action of the model or the platform, so the codes its failure shows are unknown; ${name}`,
    }
  }

  return failure.codes.length > 0
    ? { codes: failure.codes }
    : { why: `${failing} fails with no code; ${name}` }
}

function showOf(
  value: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing: string | undefined,
): unknown {
  if (typeof value === 'string') {
    const shown = shownBy(value, expansion, failing)

    if ('why' in shown) {
      expansion.issues.push({ at, message: shown.why })

      return undefined
    }

    return { type: 'show', params: { anchor: value, codes: [...shown.codes] } }
  }

  if (isRecord(value)) {
    const entries = Object.entries(value)
    const [only] = entries

    if (entries.length === 1 && only !== undefined) {
      return { type: 'show', params: { anchor: only[0], codes: only[1] } }
    }
  }

  return undefined
}

/** One effect, expanded when it is written by its name. */
export function effectOf(
  effect: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing?: string,
): unknown {
  if (!isRecord(effect) || 'type' in effect) {
    return effect
  }

  const entries = Object.entries(effect)
  const [only] = entries

  if (entries.length !== 1 || only === undefined) {
    return effect
  }

  const [name, value] = only

  if (name === 'show') {
    return showOf(value, expansion, [...at, 'show'], failing) ?? effect
  }

  if (name === 'clear' && typeof value === 'string') {
    return { type: 'clear', params: { anchor: value } }
  }

  if (name === 'navigate') {
    if (typeof value === 'string') {
      return { type: 'navigate', params: { to: value } }
    }

    if (isRecord(value)) {
      return { type: 'navigate', params: value }
    }
  }

  return effect
}

/** The effects of a list, each expanded; anything but a list is left as it is. */
export function effectsOf(
  value: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing?: string,
): unknown {
  return Array.isArray(value)
    ? value.map((effect: unknown, index) => effectOf(effect, expansion, [...at, index], failing))
    : value
}

function transitionOf(
  transition: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing: string | undefined,
): unknown {
  if (typeof transition === 'string') {
    return { target: transition }
  }

  if (isRecord(transition) && transition['actions'] !== undefined) {
    return {
      ...transition,
      actions: effectsOf(transition['actions'], expansion, [...at, 'actions'], failing),
    }
  }

  return transition
}

/** One transition or a list of guarded ones, each expanded. */
export function transitionsOf(
  value: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing?: string,
): unknown {
  return Array.isArray(value)
    ? value.map((each: unknown, index) => transitionOf(each, expansion, [...at, index], failing))
    : transitionOf(value, expansion, at, failing)
}
