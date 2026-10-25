/**
 * An effect and a transition as a screen file may author them, expanded into the forms XState
 * runs: `show: <anchor>` (one of the codes the anchor declares, in its order), `show: {
 * <anchor>: [codes] }`, `clear: <anchor>`, `navigate: <path>` or `navigate: { to, search }`
 * into `{ type, params }`; a transition that is its target alone into `{ target }`. What is
 * not one of these forms is left as it is, for the canonical schema to judge.
 */

import { isRecord } from '../../records'

import type { Expansion } from './expansion'

function showOf(value: unknown, expansion: Expansion, at: readonly PropertyKey[]): unknown {
  if (typeof value === 'string') {
    const codes = expansion.codesOf(value)

    if (codes === undefined || codes.length === 0) {
      expansion.issues.push({
        at,
        message:
          codes === undefined
            ? `no screen declares the anchor ${value}`
            : `the anchor ${value} declares no codes; name the ones it shows here: show: { ${value}: [<code>] }`,
      })

      return undefined
    }

    return { type: 'show', params: { anchor: value, codes: [...codes] } }
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
    return showOf(value, expansion, [...at, 'show']) ?? effect
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
): unknown {
  return Array.isArray(value)
    ? value.map((effect: unknown, index) => effectOf(effect, expansion, [...at, index]))
    : value
}

function transitionOf(
  transition: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
): unknown {
  if (typeof transition === 'string') {
    return { target: transition }
  }

  if (isRecord(transition) && transition['actions'] !== undefined) {
    return {
      ...transition,
      actions: effectsOf(transition['actions'], expansion, [...at, 'actions']),
    }
  }

  return transition
}

/** One transition or a list of guarded ones, each expanded. */
export function transitionsOf(
  value: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
): unknown {
  return Array.isArray(value)
    ? value.map((each: unknown, index) => transitionOf(each, expansion, [...at, index]))
    : transitionOf(value, expansion, at)
}
