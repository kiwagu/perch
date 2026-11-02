/**
 * The requests of a flow: each state that runs an action (an `invoke`), with the two things the
 * request pattern needs, found apart, or why each is missing.
 *
 * - The way back, taken when the state writes no `onError`: the one sibling state whose
 *   transitions on control events enter it. A state where its area starts (the `initial` of the
 *   root or of its region) has none, whatever enters it; so has a state nothing enters, one two
 *   states enter, one an invoke's outcome enters, or one entered from outside its area (a deep
 *   target from the root, an id target, the parallel state's own `on`).
 * - The error its failure shows on: the part the controls of every transition entering it sit
 *   in, however many states those leave; with no control entering, the part of the invoke's
 *   input fields; one part, whose `<part>.error`, else the screen's `<screen>.error`.
 *
 * Read on the flow as written or as expanded: a transition may be its target alone.
 */

import { entriesOf, isRecord, listOf, recordOf } from '../../records'
import { enteredBy, type Place } from '../flow-places'

import { partOf } from './form-params'

export interface Request {
  /** The state's name among its siblings. */
  readonly name: string
  /** Its names from the root: `['viewing', 'password', 'changing']`. */
  readonly names: readonly string[]
  /** Where it is in the flow: `['states', 'viewing', 'states', 'password', 'states', 'changing']`. */
  readonly at: readonly PropertyKey[]
  readonly state: Readonly<Record<string, unknown>>
  readonly src: string
  /** The invoke's `onError` as written, if any. */
  readonly onError: unknown
  /** The state a failure goes back to when the flow writes no `onError`, or why there is none. */
  readonly back: { readonly state: string } | { readonly why: string }
  /** The error anchor a failure shows its codes on, or why there is none. */
  readonly error: { readonly anchor: string } | { readonly why: string }
}

interface Located {
  readonly name: string
  readonly names: readonly string[]
  readonly at: readonly PropertyKey[]
  readonly node: unknown
  readonly place: Place
  /** Whether its area starts in it: it is the `initial` of the root or of its region. */
  readonly starts: boolean
}

/** An enterer of a state: the state it leaves, and the event, undefined for an invoke's outcome. */
interface Enterer {
  readonly from: Located
  readonly event: string | undefined
}

const PLATFORM_EVENT = 'platform.'
const MODEL_EVENT = 'model.'

const targetOf = (transition: unknown): unknown =>
  typeof transition === 'string' ? transition : recordOf(transition)['target']

/** An `onError` written as its target alone (a string, or one record without actions): it keeps the default show. */
export const isBare = (onError: unknown): boolean =>
  typeof onError === 'string' || (isRecord(onError) && onError['actions'] === undefined)

/**
 * Every state under `states`, whose area starts in `initial`, regions and their states included,
 * in the order written.
 */
function locatedAll(
  states: Readonly<Record<string, unknown>>,
  initial: unknown,
  root: Readonly<Record<string, unknown>>,
  names: readonly string[],
  at: readonly PropertyKey[],
): Located[] {
  return entriesOf(states).flatMap(([name, node]) => {
    const here: Located = {
      name,
      names: [...names, name],
      at: [...at, 'states', name],
      node,
      place: { self: node, siblings: states, root },
      starts: name === initial,
    }
    const { states: inner, initial: innerInitial } = recordOf(node)

    return [
      here,
      ...(isRecord(inner) ? locatedAll(inner, innerInitial, root, here.names, here.at) : []),
    ]
  })
}

/** The enterers of every state, by the state's identity. */
function enterersOf(located: readonly Located[]): Map<unknown, Enterer[]> {
  const into = new Map<unknown, Enterer[]>()
  const add = (target: unknown, from: Located, event: string | undefined): void => {
    for (const entered of enteredBy(target, from.place)) {
      into.set(entered, [...(into.get(entered) ?? []), { from, event }])
    }
  }

  for (const from of located) {
    const { on, invoke } = recordOf(from.node)

    for (const [event, value] of entriesOf(on)) {
      for (const branch of listOf(value)) {
        add(targetOf(branch), from, event)
      }
    }

    for (const key of ['onDone', 'onError'] as const) {
      for (const branch of listOf(recordOf(invoke)[key])) {
        add(targetOf(branch), from, undefined)
      }
    }
  }

  return into
}

const isControl = (event: string): boolean =>
  !event.startsWith(PLATFORM_EVENT) && !event.startsWith(MODEL_EVENT)

const inputFieldsOf = (invoke: Readonly<Record<string, unknown>>): string[] =>
  Object.values(recordOf(invoke['input'])).filter(
    (value): value is string => typeof value === 'string',
  )

function backOf(state: Located, enterers: readonly Enterer[]): Request['back'] {
  const { name } = state
  const froms = [...new Set(enterers.map(({ from }) => from))]
  const [from] = froms

  if (state.starts) {
    return { why: `${name} is where its area starts, so it has no single way back` }
  }

  if (from === undefined) {
    return { why: `nothing enters ${name}, so it has no way back` }
  }

  if (froms.length > 1) {
    return {
      why: `${name} is entered from ${froms.map((each) => each.name).join(' and ')}: no single way back`,
    }
  }

  if (from.place.siblings !== state.place.siblings) {
    return { why: `${name} is entered from outside its area (${from.name})` }
  }

  if (enterers.some(({ event }) => event === undefined)) {
    return { why: `${name} is entered by the outcome of ${from.name}, not by a control` }
  }

  return { state: from.name }
}

function errorOf(
  state: Located,
  enterers: readonly Enterer[],
  screen: string,
  declared: (anchor: string) => boolean,
): Request['error'] {
  const { name } = state
  const controls = enterers.flatMap(({ event }) =>
    event !== undefined && isControl(event) ? [event] : [],
  )
  const byControls = controls.length > 0
  const anchors = byControls ? controls : inputFieldsOf(recordOf(recordOf(state.node)['invoke']))
  const parts = [...new Set(anchors.map(partOf))]
  const [part] = parts

  if (part === undefined) {
    return { why: `no control enters ${name} and its input names no field: no part has its error` }
  }

  if (parts.length > 1) {
    const which = byControls
      ? `the controls that enter ${name}`
      : `the fields the input of ${name} names`

    return { why: `${which} sit in different parts (${parts.join(', ')})` }
  }

  const anchor = [`${part}.error`, `${screen}.error`].find(declared)

  return anchor === undefined ? { why: `no ${part}.error and no ${screen}.error` } : { anchor }
}

/**
 * The requests of `flow` (as read: `{ initial, states }`), on the screen `screen` whose anchors
 * `declared` knows.
 */
export function requestsOf(
  flow: unknown,
  screen: string,
  declared: (anchor: string) => boolean,
): Request[] {
  const { states, initial } = recordOf(flow)

  if (!isRecord(states)) {
    return []
  }

  const located = locatedAll(states, initial, states, [], [])
  const enterers = enterersOf(located)

  return located.flatMap((state): Request[] => {
    const node = recordOf(state.node)
    const invoke = recordOf(node['invoke'])
    const src = invoke['src']
    const entering = enterers.get(state.node) ?? []

    return typeof src === 'string'
      ? [
          {
            name: state.name,
            names: state.names,
            at: state.at,
            state: node,
            src,
            onError: invoke['onError'],
            back: backOf(state, entering),
            error: errorOf(state, entering, screen, declared),
          },
        ]
      : []
  })
}
