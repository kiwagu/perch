/**
 * Rule 8: a screen's flow is a machine XState runs as written, naming only what the
 * contract declares. Its `initial` and every `target` are states of the flow; every event
 * is a declared anchor (a derived one through its base's `derived`) or a platform event of
 * `platform.events`; an `invoke` runs an action as a binding does (rule 3), its `input`
 * keyed by that action's parameters; a `show` names a declared anchor and codes it carries,
 * a `navigate` the path of a binding and search parameters of that binding; every guard is
 * declared in `meta.guards` and every declared one is used; every state is reachable from
 * `initial` and every state that is not final has an event or an invoke to leave it; per
 * event at most one transition has no guard, and it is the last, as XState takes the first
 * whose guard holds; a state's `meta.address` names a binding of its own screen (its first
 * one when the path is left out) and search parameters of that binding.
 */

import type {
  AnchorDef,
  Binding,
  Effect,
  Flow,
  FlowState,
  FlowTransition,
  Problem,
  Screen,
} from '../files'

import { type Contract, declaredAnchors, has, own, PLATFORM_ACTION } from './contract'
import { actionProblems, type Lookups, lookupsOf, routeProblems } from './lookups'

type At = readonly PropertyKey[]

type Transitions = FlowTransition | FlowTransition[]

/** A platform event is named as a platform action is: `platform.<name>`. */
const PLATFORM_EVENT = PLATFORM_ACTION

/** One flow as the checks read it, with the lookups of the whole contract. */
interface InFlow extends Lookups {
  readonly screen: Screen
  readonly flow: Flow
  /** Where the flow is: `screens[i].flow`. */
  readonly at: At
  readonly defs: ReadonlyMap<string, AnchorDef>
  readonly bindings: ReadonlyMap<string, Binding>
}

const listOf = (transitions: Transitions): readonly FlowTransition[] =>
  Array.isArray(transitions) ? transitions : [transitions]

/** Every transition a state may take: on its events, and when its invoke ends. */
const transitionsOf = (state: FlowState): FlowTransition[] => [
  ...Object.values(state.on ?? {}).flatMap(listOf),
  ...(state.invoke === undefined
    ? []
    : [...listOf(state.invoke.onDone), ...listOf(state.invoke.onError ?? [])]),
]

const searchProblems = (
  { inScreens }: InFlow,
  binding: Binding,
  search: Readonly<Record<string, unknown>> | undefined,
  at: At,
): Problem[] =>
  Object.keys(search ?? {})
    .filter((key) => !has(binding.search?.properties ?? {}, key))
    .map((key) =>
      inScreens([...at, key], `"${key}" is not a search parameter of "${binding.path}"`),
    )

function effectProblems(inFlow: InFlow, effects: readonly Effect[] | undefined, at: At): Problem[] {
  const { inScreens } = inFlow

  return (effects ?? []).flatMap((effect, index) => {
    const params = [...at, index, 'params']

    if (effect.type === 'navigate') {
      const { to, search } = effect.params
      const binding = inFlow.bindings.get(to)

      return binding === undefined
        ? routeProblems(inFlow, to, [...params, 'to'])
        : searchProblems(inFlow, binding, search, [...params, 'search'])
    }

    const { anchor, codes } = effect.params
    const def = inFlow.defs.get(anchor)

    if (def === undefined) {
      return [inScreens([...params, 'anchor'], `"${anchor}" is not a declared anchor`)]
    }

    return codes.flatMap((code, number) =>
      (def.codes ?? []).includes(code)
        ? []
        : [inScreens([...params, 'codes', number], `"${anchor}" carries no code "${code}"`)],
    )
  })
}

function transitionProblems(inFlow: InFlow, transition: FlowTransition, at: At): Problem[] {
  const { flow, inScreens } = inFlow
  const { target, guard } = transition

  return [
    ...(target === undefined || has(flow.states, target)
      ? []
      : [inScreens([...at, 'target'], `"${target}" is not a state of the flow`)]),
    ...(guard === undefined || has(flow.meta?.guards ?? {}, guard)
      ? []
      : [inScreens([...at, 'guard'], `"${guard}" is not a guard of meta.guards`)]),
    ...effectProblems(inFlow, transition.actions, [...at, 'actions']),
  ]
}

/** One transition or a list of them: at most one without a guard, and that one last. */
function transitionsProblems(inFlow: InFlow, transitions: Transitions, at: At): Problem[] {
  const list = listOf(transitions)
  const unguarded = list.flatMap(({ guard }, index) => (guard === undefined ? [index] : []))
  const order =
    unguarded.length > 1
      ? [inFlow.inScreens(at, 'holds more than one transition without a guard')]
      : unguarded.filter((index) => index !== list.length - 1).length > 0
        ? [inFlow.inScreens(at, 'the transition without a guard is not the last')]
        : []

  return [
    ...order,
    ...list.flatMap((transition, index) =>
      transitionProblems(inFlow, transition, Array.isArray(transitions) ? [...at, index] : at),
    ),
  ]
}

function eventProblems(inFlow: InFlow, event: string, at: At): Problem[] {
  const { contract, known, inScreens } = inFlow

  if (event.startsWith(PLATFORM_EVENT)) {
    return has(contract.screens.platform.events ?? {}, event.slice(PLATFORM_EVENT.length))
      ? []
      : [inScreens(at, `"${event}" is not an event of platform.events`)]
  }

  return known(event) ? [] : [inScreens(at, `"${event}" is not a declared anchor`)]
}

function addressProblems(inFlow: InFlow, state: FlowState, at: At): Problem[] {
  const address = state.meta?.address

  if (address === undefined) {
    return []
  }

  const { path, search } = address
  const { bindings } = inFlow.screen
  const binding =
    path === undefined ? bindings[0] : bindings.find((candidate) => candidate.path === path)

  if (binding === undefined) {
    return path === undefined
      ? [inFlow.inScreens([...at, 'search'], 'the screen has no binding')]
      : [inFlow.inScreens([...at, 'path'], `"${path}" is the path of no binding of the screen`)]
  }

  return searchProblems(inFlow, binding, search, [...at, 'search'])
}

function stateProblems(inFlow: InFlow, name: string, state: FlowState): Problem[] {
  const at = [...inFlow.at, 'states', name]
  const { invoke } = state

  return [
    ...addressProblems(inFlow, state, [...at, 'meta', 'address']),
    ...effectProblems(inFlow, state.entry, [...at, 'entry']),
    ...effectProblems(inFlow, state.exit, [...at, 'exit']),
    ...Object.entries(state.on ?? {}).flatMap(([event, transitions]) => [
      ...eventProblems(inFlow, event, [...at, 'on', event]),
      ...transitionsProblems(inFlow, transitions, [...at, 'on', event]),
    ]),
    ...(invoke === undefined
      ? []
      : [
          ...actionProblems(inFlow, invoke.src, invoke.input, {
            action: [...at, 'invoke', 'src'],
            params: [...at, 'invoke', 'input'],
          }),
          ...transitionsProblems(inFlow, invoke.onDone, [...at, 'invoke', 'onDone']),
          ...(invoke.onError === undefined
            ? []
            : transitionsProblems(inFlow, invoke.onError, [...at, 'invoke', 'onError'])),
        ]),
  ]
}

function unusedGuardProblems({ flow, at, inScreens }: InFlow): Problem[] {
  const used = new Set(
    Object.values(flow.states)
      .flatMap(transitionsOf)
      .flatMap(({ guard }) => (guard === undefined ? [] : [guard])),
  )

  return Object.keys(flow.meta?.guards ?? {})
    .filter((guard) => !used.has(guard))
    .map((guard) =>
      inScreens([...at, 'meta', 'guards', guard], 'is declared but no transition uses it'),
    )
}

/** The states no path of transitions leads to from `initial`, a transition without a target staying. */
function unreachableProblems({ flow, at, inScreens }: InFlow): Problem[] {
  const reached = new Set<string>()
  const next = has(flow.states, flow.initial) ? [flow.initial] : []

  for (let name = next.pop(); name !== undefined; name = next.pop()) {
    const state = reached.has(name) ? undefined : own(flow.states, name)

    reached.add(name)
    next.push(
      ...(state === undefined ? [] : transitionsOf(state))
        .flatMap(({ target }) => (target === undefined ? [] : [target]))
        .filter((target) => has(flow.states, target) && !reached.has(target)),
    )
  }

  return Object.keys(flow.states)
    .filter((name) => !reached.has(name))
    .map((name) => inScreens([...at, 'states', name], `is not reachable from "${flow.initial}"`))
}

const stuckProblems = ({ flow, at, inScreens }: InFlow): Problem[] =>
  Object.entries(flow.states)
    .filter(
      ([, state]) =>
        state.type !== 'final' &&
        Object.keys(state.on ?? {}).length === 0 &&
        state.invoke === undefined,
    )
    .map(([name]) =>
      inScreens([...at, 'states', name], 'is not final and has no event or invoke to leave it'),
    )

export function flowProblems(contract: Contract): Problem[] {
  const lookups = lookupsOf(contract)
  const defs = new Map(declaredAnchors(contract.screens).map(({ anchor, def }) => [anchor, def]))
  const bindings = new Map(
    contract.screens.screens.flatMap(({ bindings: of }) =>
      of.map((binding) => [binding.path, binding] as const),
    ),
  )

  return contract.screens.screens.flatMap((screen, index) => {
    const { flow } = screen

    if (flow === undefined) {
      return []
    }

    const inFlow: InFlow = {
      ...lookups,
      screen,
      flow,
      at: ['screens', index, 'flow'],
      defs,
      bindings,
    }

    return [
      ...(has(flow.states, flow.initial)
        ? []
        : [
            lookups.inScreens(
              [...inFlow.at, 'initial'],
              `"${flow.initial}" is not a state of the flow`,
            ),
          ]),
      ...Object.entries(flow.states).flatMap(([name, state]) => stateProblems(inFlow, name, state)),
      ...unusedGuardProblems(inFlow),
      ...unreachableProblems(inFlow),
      ...stuckProblems(inFlow),
    ]
  })
}
