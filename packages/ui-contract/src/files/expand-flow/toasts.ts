/**
 * The success of an action of the model, said on the frame's toast. Each invoke of a model action
 * (`<entity>.<verb><Object>`, never `platform.*`) gets, on every branch of its `onDone`,
 * `show: { <toast>: [<code>] }`: `<object>-created`, `-updated` or `-deleted` by the verb, or
 * `<action>-done` for another verb. An `onDone` that shows something already gets none (what
 * the file writes wins), and an invoke that says `toast: false` gets none and loses the key, which
 * the canonical flow does not know. It runs on the flow as expanded, written and derived regions
 * alike; without a toast anchor on the frame it derives nothing. The codes the flow's own `show`s
 * put on the toast anchor are written codes, reported apart: each needs its own vocabulary row,
 * even where a derivation elsewhere gives the same code.
 */

import { isRecord, listOf, recordOf } from '../../records'
import { toastCodesOf } from '../derive'

import type { Expansion } from './expansion'

const PLATFORM = 'platform.'
const PAST: ReadonlyMap<string, string> = new Map([
  ['create', 'created'],
  ['update', 'updated'],
  ['delete', 'deleted'],
])

/** `camelCase` as `kebab-case`. */
const kebab = (name: string): string =>
  name.replace(/[A-Z]/g, (upper, at: number) => `${at === 0 ? '' : '-'}${upper.toLowerCase()}`)

/** The code a toast says the success of `src` with; none for a platform action. */
export function toastCodeOf(src: string): string | undefined {
  if (src.startsWith(PLATFORM) || !src.includes('.')) {
    return undefined
  }

  const action = src.slice(src.indexOf('.') + 1)
  const [, verb = '', object = ''] = /^([a-z]+)([A-Z].*)?$/.exec(action) ?? []
  const past = PAST.get(verb)

  return past === undefined || object === '' ? `${kebab(action)}-done` : `${kebab(object)}-${past}`
}

/** Whether a branch of `onDone` shows something. */
const shows = (onDone: unknown): boolean =>
  listOf(onDone).some((branch) =>
    listOf(recordOf(branch)['actions']).some((effect) => recordOf(effect)['type'] === 'show'),
  )

/** `branch` with `show` after its own effects; what is no transition is left as it is. */
function withShow(branch: unknown, show: unknown): unknown {
  if (!isRecord(branch)) {
    return branch
  }

  const { actions } = branch

  if (actions !== undefined && !Array.isArray(actions)) {
    return branch
  }

  return { ...branch, actions: [...listOf(actions), show] }
}

function invokeOf(invoke: Readonly<Record<string, unknown>>, expansion: Expansion): unknown {
  const { toast: optOut, ...rest } = invoke

  if (optOut === false) {
    return rest
  }

  const src = typeof invoke['src'] === 'string' ? invoke['src'] : undefined
  const code = src === undefined ? undefined : toastCodeOf(src)
  const { toast } = expansion
  const { onDone } = invoke

  // Any other `toast` value stays for the canonical schema to refuse.
  if (
    optOut !== undefined ||
    toast === undefined ||
    src === undefined ||
    code === undefined ||
    onDone === undefined ||
    shows(onDone)
  ) {
    return invoke
  }

  const show = { type: 'show', params: { anchor: toast, codes: [code] } }

  expansion.toasts.push({ anchor: toast, code, action: src })

  return {
    ...invoke,
    onDone: Array.isArray(onDone)
      ? onDone.map((branch: unknown) => withShow(branch, show))
      : withShow(onDone, show),
  }
}

/** `nodes` by name, each walked; the same record when none of them changed. */
function walkedAll(
  nodes: Readonly<Record<string, unknown>>,
  expansion: Expansion,
): Readonly<Record<string, unknown>> {
  const entries = Object.entries(nodes).map(([name, node]): [string, unknown] => [
    name,
    walked(node, expansion),
  ])

  return entries.every(([name, node]) => node === nodes[name]) ? nodes : Object.fromEntries(entries)
}

/**
 * A state, a parallel state or a region, its invoke and the nodes under it walked; the node
 * itself when nothing in it changed, so what the expansion left as written stays so.
 */
function walked(node: unknown, expansion: Expansion): unknown {
  if (!isRecord(node)) {
    return node
  }

  const { invoke, states } = node
  const nextInvoke = isRecord(invoke) ? invokeOf(invoke, expansion) : invoke
  const nextStates = isRecord(states) ? walkedAll(states, expansion) : states

  if (nextInvoke === invoke && nextStates === states) {
    return node
  }

  return {
    ...node,
    ...(nextInvoke === undefined ? {} : { invoke: nextInvoke }),
    ...(nextStates === undefined ? {} : { states: nextStates }),
  }
}

/**
 * `states`, the states of the root as expanded, with the toasts of the model actions' successes;
 * the codes the flow writes on the toast anchor itself are recorded first.
 */
export function withDerivedToasts(
  states: Readonly<Record<string, unknown>>,
  expansion: Expansion,
): Readonly<Record<string, unknown>> {
  if (expansion.toast !== undefined) {
    expansion.writtenToasts.push(...toastCodesOf([states], expansion.toast))
  }

  return walkedAll(states, expansion)
}
