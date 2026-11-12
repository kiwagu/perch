/**
 * An effect and a transition as a screen file may author them, expanded into the forms XState
 * runs: `show: <anchor>` (one of the codes the anchor carries, in its order; in the `onError`
 * of an invoke, one of the codes the failure of its action shows), `show: { <anchor>: [codes]
 * }`, `clear: <anchor>`, `read: <anchor>`, `navigate: <path>` or `navigate: { to, search }` into `{ type, params
 * }`; a transition that is its target alone into `{ target }`. What is not one of these forms
 * is left as it is, for the canonical schema to judge. `failing` is the action whose failure
 * the transitions follow, in an `onError`. There the guards by failure code split the failure
 * across the branches, in their order: on a branch guarded by one, `show: <anchor>` shows
 * exactly its codes; on a later branch with no guard or a sentence guard, the failure's codes
 * but those the code-guarded branches before it take.
 */

import { isRecord } from '../../records'

import type { Expansion } from './expansion'

/** The failure a branch of an `onError` follows, and what the guards by failure code take of it. */
interface Failing {
  readonly action: string
  /** The codes of the branch's own guard by failure code: it takes exactly these. */
  readonly guarded: readonly string[] | undefined
  /** The codes the code-guarded branches before it take, which never reach it. */
  readonly taken: readonly string[]
}

/** The codes the failure shows on a branch, or why it shows none. */
function failureShownBy(
  failing: Failing,
  carried: readonly string[],
  expansion: Expansion,
  name: string,
): { codes: readonly string[] } | { why: string } {
  const { action, guarded, taken } = failing

  if (guarded !== undefined) {
    return { codes: guarded }
  }

  const failure = expansion.failureOf(action)

  if (failure === 'unloaded') {
    return { codes: carried.length > 0 ? carried : ['failed'] }
  }

  if (failure === undefined) {
    return {
      why: `${action} is no action of the model or the platform, so the codes its failure shows are unknown; ${name}`,
    }
  }

  if (failure.codes.length === 0) {
    return { why: `${action} fails with no code; ${name}` }
  }

  const left = failure.codes.filter((code) => !taken.includes(code))

  return left.length > 0
    ? { codes: left }
    : {
        why: `the branches guarded by failure code before this one take every code ${action} fails with; ${name}`,
      }
}

/**
 * The codes `show: <anchor>` shows here, or why it shows none. While the file of the failing
 * action does not load, the anchor's own codes stand in, so that file's problems are the ones
 * reported.
 */
function shownBy(
  anchor: string,
  expansion: Expansion,
  failing: Failing | undefined,
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

  return failureShownBy(failing, carried, expansion, name)
}

function showOf(
  value: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing: Failing | undefined,
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
  failing?: Failing,
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

  if (name === 'read' && typeof value === 'string') {
    return { type: 'read', params: { anchor: value } }
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
  failing?: Failing,
): unknown {
  return Array.isArray(value)
    ? value.map((effect: unknown, index) => effectOf(effect, expansion, [...at, index], failing))
    : value
}

function transitionOf(
  transition: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing: Failing | undefined,
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

/** The codes of the guard by failure code a transition names, when it names one. */
function guardedBy(transition: unknown, expansion: Expansion): readonly string[] | undefined {
  const guard = isRecord(transition) ? transition['guard'] : undefined

  return typeof guard === 'string' ? expansion.codeGuards.get(guard) : undefined
}

/**
 * One transition or a list of guarded ones, each expanded; in an `onError` (`failing` names its
 * action), each branch with the codes the guards by failure code leave it, in their order.
 */
export function transitionsOf(
  value: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
  failing?: string,
): unknown {
  const taken: string[] = []
  const branchOf = (each: unknown, where: readonly PropertyKey[]): unknown => {
    const guarded = guardedBy(each, expansion)
    const branch =
      failing === undefined ? undefined : { action: failing, guarded, taken: [...taken] }

    taken.push(...(guarded ?? []))

    return transitionOf(each, expansion, where, branch)
  }

  return Array.isArray(value)
    ? value.map((each: unknown, index) => branchOf(each, [...at, index]))
    : branchOf(value, at)
}
