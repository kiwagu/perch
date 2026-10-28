/**
 * The success of a mutation, said on the frame's toast. Each invoke of a model action
 * (`<entity>.<verb><Object>`) gets, on every branch of its `onDone`, `show: { <toast>: [<code>] }`:
 * `<object>-created`, `-updated` or `-deleted` by the verb, or `<action>-done` for another verb;
 * a platform action toasts only when the platform's `toasts` map names it, with the code the map
 * gives. The toast says an operation's outcome once, where it ends: a branch that leads into
 * another such action (one Save running two) toasts nothing, and the toast of a chain names the
 * operation by the control that starts it (`operations.ts`). A branch that shows its own message
 * on the toast keeps it (a written message wins on its anchor, branch by branch; a notice or an
 * error written there leaves the toast on), and an invoke that says `toast: false`, the one ban,
 * gets none and loses the key, which the canonical flow does not know. It runs on the flow as
 * expanded, written and derived regions alike; without a toast anchor on the frame it derives
 * nothing. The codes the flow's own `show`s put on the toast anchor are written codes, reported
 * apart: each needs its own vocabulary row, even where a derivation elsewhere gives the same code.
 */

import { isRecord, listOf, recordOf } from '../../../records'
import { toastCodesOf } from '../../derive'
import type { Expansion } from '../expansion'

import { codeOf } from './codes'
import { type Operations, operationsOf } from './operations'
import { enteredBy, type Place } from './places'

/** What the walk of a flow reads: the expansion, and the outcomes of the flow's operations. */
interface Walk {
  readonly expansion: Expansion
  readonly operations: Operations
}

/** Whether `branch`, one branch of an `onDone`, shows something on `anchor`. */
const showsOn = (branch: unknown, anchor: string): boolean =>
  listOf(recordOf(branch)['actions']).some(
    (effect) =>
      recordOf(effect)['type'] === 'show' &&
      recordOf(recordOf(effect)['params'])['anchor'] === anchor,
  )

/**
 * Whether `branch` leads into another mutation of the same operation: a state it enters, other
 * than the invoking state itself (a target on itself re-enters nothing), runs an action whose
 * success toasts. Such a step says nothing; the operation's toast comes where it ends.
 */
const continues = (branch: unknown, place: Place, expansion: Expansion): boolean =>
  enteredBy(recordOf(branch)['target'], place).some((state) => {
    const src = recordOf(recordOf(state)['invoke'])['src']

    return state !== place.self && typeof src === 'string' && codeOf(src, expansion) !== undefined
  })

/**
 * Whether `branch` takes the standard toast after its own effects: a transition that shows no
 * message of its own on the toast and leads into no next mutation of its operation.
 */
function takesShow(branch: unknown, toast: string, place: Place, expansion: Expansion): boolean {
  if (!isRecord(branch) || showsOn(branch, toast) || continues(branch, place, expansion)) {
    return false
  }

  const { actions } = branch

  return actions === undefined || Array.isArray(actions)
}

function invokeOf(invoke: Readonly<Record<string, unknown>>, place: Place, walk: Walk): unknown {
  const { expansion } = walk
  const { toast: optOut, ...rest } = invoke

  if (optOut === false) {
    return rest
  }

  const src = typeof invoke['src'] === 'string' ? invoke['src'] : undefined
  const { toast } = expansion
  const { onDone } = invoke

  // Any other `toast` value stays for the canonical schema to refuse.
  if (
    optOut !== undefined ||
    toast === undefined ||
    src === undefined ||
    codeOf(src, expansion) === undefined ||
    onDone === undefined
  ) {
    return invoke
  }

  const branches = listOf(onDone)
  const takes = branches.map((branch) => takesShow(branch, toast, place, expansion))
  // Every branch says its own message on the toast, or leads on: nothing is derived.
  const outcome = takes.some(Boolean) ? walk.operations(place.self) : undefined

  if (outcome === undefined) {
    return invoke
  }

  const show = { type: 'show', params: { anchor: toast, codes: [outcome.code] } }
  const shown = branches.map((branch, at) =>
    takes[at] === true
      ? { ...recordOf(branch), actions: [...listOf(recordOf(branch)['actions']), show] }
      : branch,
  )

  expansion.toasts.push({ anchor: toast, ...outcome })

  return { ...invoke, onDone: Array.isArray(onDone) ? shown : shown[0] }
}

/** `nodes` by name, each walked beside the others; the same record when none of them changed. */
function walkedAll(
  nodes: Readonly<Record<string, unknown>>,
  root: Readonly<Record<string, unknown>>,
  walk: Walk,
): Readonly<Record<string, unknown>> {
  const entries = Object.entries(nodes).map(([name, node]): [string, unknown] => [
    name,
    walked(node, { self: node, siblings: nodes, root }, walk),
  ])

  return entries.every(([name, node]) => node === nodes[name]) ? nodes : Object.fromEntries(entries)
}

/**
 * A state, a parallel state or a region, its invoke and the nodes under it walked; the node
 * itself when nothing in it changed, so what the expansion left as written stays so.
 */
function walked(node: unknown, place: Place, walk: Walk): unknown {
  if (!isRecord(node)) {
    return node
  }

  const { invoke, states } = node
  const nextInvoke = isRecord(invoke) ? invokeOf(invoke, place, walk) : invoke
  const nextStates = isRecord(states) ? walkedAll(states, place.root, walk) : states

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
 * `states`, the states of the root as expanded, with the toasts of the operations' outcomes; the
 * codes the flow writes on the toast anchor itself are recorded first. `at` is where the flow
 * sits in its file, for the issues of the operations it refuses.
 */
export function withDerivedToasts(
  states: Readonly<Record<string, unknown>>,
  expansion: Expansion,
  at: readonly PropertyKey[],
): Readonly<Record<string, unknown>> {
  if (expansion.toast === undefined) {
    return walkedAll(states, states, { expansion, operations: () => undefined })
  }

  expansion.writtenToasts.push(...toastCodesOf([states], expansion.toast))

  return walkedAll(states, states, { expansion, operations: operationsOf(states, expansion, at) })
}
