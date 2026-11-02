/**
 * The requests of a flow: each state that runs an action (an `invoke`), with the one way back
 * the request pattern takes when the state writes no `onError`: the one sibling state whose
 * transitions on control events enter it, and the error anchor of the part those controls sit
 * in (`<part>.error`), else the screen's (`<screen>.error`); with no control entering, the
 * part of the invoke's input fields. An initial state, a state two states enter, one an
 * invoke's outcome enters, or one entered from outside its area (a deep target from the root,
 * an id target, the parallel state's own `on`) has no single way back, and says why. Read on
 * the flow as written or as expanded: a transition may be its target alone.
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
  /** The default's way back and error anchor, or why there is none. */
  readonly fallback: { readonly back: string; readonly error: string } | { readonly why: string }
}

interface Located {
  readonly name: string
  readonly names: readonly string[]
  readonly at: readonly PropertyKey[]
  readonly node: unknown
  readonly place: Place
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

/** Every state under `states`, regions and their states included, in the order written. */
function locatedAll(
  states: Readonly<Record<string, unknown>>,
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
    }
    const inner = recordOf(node)['states']

    return [here, ...(isRecord(inner) ? locatedAll(inner, root, here.names, here.at) : [])]
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

function fallbackOf(
  state: Located,
  enterers: readonly Enterer[],
  screen: string,
  declared: (anchor: string) => boolean,
): Request['fallback'] {
  const { name } = state
  const froms = [...new Set(enterers.map(({ from }) => from))]
  const [from] = froms

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

  const controls = enterers.flatMap(({ event }) =>
    event !== undefined && isControl(event) ? [event] : [],
  )
  const anchors =
    controls.length > 0 ? controls : inputFieldsOf(recordOf(recordOf(state.node)['invoke']))
  const parts = [...new Set(anchors.map(partOf))]
  const [part] = parts

  if (part === undefined) {
    return { why: `no control enters ${name} and its input names no field: no part has its error` }
  }

  if (parts.length > 1) {
    return { why: `the controls that enter ${name} sit in different parts (${parts.join(', ')})` }
  }

  const error = [`${part}.error`, `${screen}.error`].find(declared)

  return error === undefined
    ? { why: `no ${part}.error and no ${screen}.error` }
    : { back: from.name, error }
}

/** The requests of `flow` (as read: `{ states }`), on the screen `screen` whose anchors `declared` knows. */
export function requestsOf(
  flow: unknown,
  screen: string,
  declared: (anchor: string) => boolean,
): Request[] {
  const states = isRecord(flow) ? flow['states'] : undefined

  if (!isRecord(states)) {
    return []
  }

  const located = locatedAll(states, states, [], [])
  const enterers = enterersOf(located)

  return located.flatMap((state): Request[] => {
    const node = recordOf(state.node)
    const invoke = recordOf(node['invoke'])
    const src = invoke['src']

    return typeof src === 'string'
      ? [
          {
            name: state.name,
            names: state.names,
            at: state.at,
            state: node,
            src,
            onError: invoke['onError'],
            fallback: fallbackOf(state, enterers.get(state.node) ?? [], screen, declared),
          },
        ]
      : []
  })
}
