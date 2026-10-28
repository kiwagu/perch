/**
 * The operations of a flow, each said once on the toast. An operation starts with a transition
 * into a state that runs a toasting action (an action of the model, or a platform action the
 * platform's `toasts` map lists) and goes on along the `onDone` branches that enter another; the
 * states it runs make a chain when they are several. A chain says the operation, with the code
 * of the control whose event starts it; a chain that something other than a control starts, or
 * that controls with different codes start, is refused. So is one event that starts more than
 * one toasting action at once, not banned by `toast: false`: the entry of a parallel state whose
 * regions start them, or one press that regions handle side by side.
 */

import { isRecord, listOf, recordOf } from '../../../records'
import type { Expansion } from '../expansion'

import { codeOf, operationCodeOf } from './codes'
import { enteredBy, type Place } from './places'

/** A state of the flow: where it stands, and its path in the screen file. */
interface Located {
  readonly node: unknown
  readonly place: Place
  readonly at: readonly PropertyKey[]
}

/** One branch of a transition: the state it leaves, the event of an `on` handler, its path. */
interface Branch {
  readonly from: Located
  readonly event: string | undefined
  readonly done: boolean
  readonly branch: unknown
  readonly at: readonly PropertyKey[]
}

/** What the toast says where an operation ends: its code, the action or the control it names. */
export interface Outcome {
  readonly code: string
  readonly action: string
}

/** The operations of a flow: the outcome the toast says where an operation ends in a state. */
export type Operations = (state: unknown) => Outcome | undefined

/** Every state under `nodes`, regions and their states included, in the order they are written. */
function locatedAll(
  nodes: Readonly<Record<string, unknown>>,
  root: Readonly<Record<string, unknown>>,
  at: readonly PropertyKey[],
): Located[] {
  return Object.entries(nodes).flatMap(([name, node]) => {
    const here = [...at, 'states', name]
    const { states } = recordOf(node)

    return [
      { node, place: { self: node, siblings: nodes, root }, at: here },
      ...(isRecord(states) ? locatedAll(states, root, here) : []),
    ]
  })
}

/** The branches of `value`, one transition or a list of guarded ones, each with its path. */
const listed = (
  value: unknown,
  at: readonly PropertyKey[],
): { branch: unknown; at: readonly PropertyKey[] }[] =>
  Array.isArray(value)
    ? listOf(value).map((branch, index) => ({ branch, at: [...at, index] }))
    : listOf(value).map((branch) => ({ branch, at }))

/** The branches of a state's `on` handlers and of its invoke's outcomes. */
function branchesOf(from: Located): Branch[] {
  const { on, invoke } = recordOf(from.node)

  return [
    ...Object.entries(recordOf(on)).flatMap(([event, value]) =>
      listed(value, [...from.at, 'on', event]).map((each) => ({
        ...each,
        from,
        event,
        done: false,
      })),
    ),
    ...(['onDone', 'onError'] as const).flatMap((key) =>
      listed(recordOf(invoke)[key], [...from.at, 'invoke', key]).map((each) => ({
        ...each,
        from,
        event: undefined,
        done: key === 'onDone',
      })),
    ),
  ]
}

const srcOf = (state: unknown): string | undefined => {
  const { src } = recordOf(recordOf(state)['invoke'])

  return typeof src === 'string' ? src : undefined
}

const isBanned = (state: unknown): boolean => recordOf(recordOf(state)['invoke'])['toast'] === false

/** Whether `path` lies under `prefix`. */
const isUnder = (path: readonly PropertyKey[], prefix: readonly PropertyKey[]): boolean =>
  prefix.every((key, index) => path[index] === key)

/**
 * The operations of `states`, the states of the root as expanded, with the issues of the chains
 * and the events that start toasting actions at once; `at` is where the flow sits in its file.
 */
export function operationsOf(
  states: Readonly<Record<string, unknown>>,
  expansion: Expansion,
  at: readonly PropertyKey[],
): Operations {
  const located = locatedAll(states, states, at)
  const branches = located.flatMap(branchesOf)
  const toasting = (state: unknown): boolean => {
    const src = srcOf(state)

    return src !== undefined && codeOf(src, expansion) !== undefined
  }
  // A target on the state itself re-enters nothing.
  const enteredOf = ({ branch, from }: Branch): unknown[] =>
    enteredBy(recordOf(branch)['target'], from.place).filter(
      (state) => state !== from.node && toasting(state),
    )
  const actionsOf = (entered: readonly unknown[]): string =>
    entered.map((state) => srcOf(state) ?? '').join(', ')

  const linked = new Map<unknown, unknown[]>()
  const starts: { state: unknown; event: string | undefined }[] = []

  for (const each of branches) {
    const entered = enteredOf(each)
    const allowed = entered.filter((state) => !isBanned(state))

    if (allowed.length > 1) {
      expansion.issues.push({
        at: each.at,
        message: `starts ${allowed.length} toasting actions at once (${actionsOf(allowed)}): write toast: false on all but one`,
      })
    }

    for (const state of entered) {
      if (each.done && toasting(each.from.node)) {
        linked.set(each.from.node, [...(linked.get(each.from.node) ?? []), state])
        linked.set(state, [...(linked.get(state) ?? []), each.from.node])
      } else {
        starts.push({ state, event: each.event })
      }
    }
  }

  for (const parallel of located.filter(({ node }) => recordOf(node)['type'] === 'parallel')) {
    const regionsOf = new Map<string, string[]>()

    for (const region of Object.keys(recordOf(recordOf(parallel.node)['states']))) {
      const inside = [...parallel.at, 'states', region]
      const events = branches.filter(
        (each) =>
          each.event !== undefined &&
          isUnder(each.from.at, inside) &&
          enteredOf(each).some((state) => !isBanned(state)),
      )

      for (const event of new Set(events.map((each) => each.event ?? ''))) {
        regionsOf.set(event, [...(regionsOf.get(event) ?? []), region])
      }
    }

    for (const [event, regions] of regionsOf) {
      if (regions.length > 1) {
        expansion.issues.push({
          at: parallel.at,
          message: `${event} starts a toasting action in ${regions.length} regions at once (${regions.join(', ')}): write toast: false on all but one`,
        })
      }
    }
  }

  const chainOf = new Map<unknown, Set<unknown>>()

  for (const state of linked.keys()) {
    if (!chainOf.has(state)) {
      const chain = new Set([state])

      for (const member of chain) {
        for (const next of linked.get(member) ?? []) {
          chain.add(next)
        }
      }

      for (const member of chain) {
        chainOf.set(member, chain)
      }
    }
  }

  const outcomes = new Map<Set<unknown>, Outcome | undefined>()

  /** The outcome of a chain, from the control that starts it; refused once, with its issue. */
  function chainOutcome(chain: Set<unknown>): Outcome | undefined {
    const events = starts.filter(({ state }) => chain.has(state)).map(({ event }) => event)
    const controls = events.filter(
      (event): event is string => event !== undefined && expansion.codesOf(event) !== undefined,
    )
    const codes = [...new Set(controls.map((event) => operationCodeOf(event, expansion.screen)))]
    const [code] = codes
    const members = located.filter(({ node }) => chain.has(node))
    const [first] = members
    const actions = actionsOf(members.map(({ node }) => node))

    if (code !== undefined && codes.length === 1 && controls.length === events.length) {
      return { code, action: controls[0] ?? '' }
    }

    expansion.issues.push({
      at: [...(first?.at ?? at), 'invoke'],
      message:
        codes.length > 1
          ? `the operation of ${actions} is started by controls whose codes differ (${codes.join(', ')}): show its own message on ${expansion.toast ?? 'the toast'} or write toast: false`
          : `the operation of ${actions} is started by no control of the screen, so it has no code: show its own message on ${expansion.toast ?? 'the toast'} or write toast: false`,
    })

    return undefined
  }

  return (state) => {
    const src = srcOf(state)
    const code = src === undefined ? undefined : codeOf(src, expansion)
    const chain = chainOf.get(state)

    if (src === undefined || code === undefined) {
      return undefined
    }

    if (chain === undefined) {
      return { code, action: src }
    }

    if (!outcomes.has(chain)) {
      outcomes.set(chain, chainOutcome(chain))
    }

    return outcomes.get(chain)
  }
}
