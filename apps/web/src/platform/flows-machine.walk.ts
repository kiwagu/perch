/**
 * A pure walk of a screen's flow in XState: `setup({ guards, actions, actors })
 * .createMachine(flow)` takes the flow of the contract unchanged, with a stub per guard of
 * `meta.guards` (it holds while the walk says so), the effects `show` and `navigate` as
 * no-ops and an actor per `invoke.src` that resolves. From every state it reaches, the walk
 * sends, with `initialTransition` and `transition` only, each event of `on` and an invoke's
 * done and error events as XState raises them (`xstate.done.actor.<id>` with its `output`,
 * `xstate.error.actor.<id>` with its `error`, the id the machine gives the invoke); each
 * branch of a guarded list once, with its own guard holding and none before it, and, when
 * the last branch is guarded too, once with none holding. Each case says what the flow
 * expects and what XState did.
 */

import {
  type AnyEventObject,
  fromPromise,
  initialTransition,
  type SnapshotFrom,
  setup,
  transition,
} from 'xstate'

import type { Effect, Flow, FlowState, FlowTransition } from '@workspace/ui-contract'

type ShowParams = Extract<Effect, { type: 'show' }>['params']
type NavigateParams = Extract<Effect, { type: 'navigate' }>['params']

/** The flow as XState runs it: a guard holds while `holds` names it; every action resolves. */
export function machineOf(flow: Flow, holds: ReadonlySet<string>) {
  const guards = Object.keys(flow.meta?.guards ?? {}).map(
    (name) => [name, () => holds.has(name)] as const,
  )
  const actors = Object.values(flow.states).flatMap(({ invoke }) =>
    invoke === undefined ? [] : [[invoke.src, fromPromise(async () => undefined)] as const],
  )

  return setup({
    types: { events: {} as AnyEventObject },
    guards: Object.fromEntries(guards),
    actions: {
      show: (_args: unknown, _params: ShowParams) => undefined,
      navigate: (_args: unknown, _params: NavigateParams) => undefined,
    },
    actors: Object.fromEntries(actors),
  }).createMachine(flow)
}

/** What a transition comes to: whether XState takes one, the state after it, its effects. */
export interface Outcome {
  readonly handled: boolean
  readonly state: string
  readonly effects: readonly unknown[]
}

/** One case of the walk: a branch of an event of a state, the guard that holds for it. */
interface Case {
  /** `<state> <event>[<branch>]`: an anchor or a platform event, `onDone` or `onError`. */
  readonly label: string
  readonly event: string
  readonly holding: string | undefined
  readonly expected: Outcome
}

export interface Walked {
  /** The states the walk reached, in the order it reached them. */
  readonly visited: readonly string[]
  readonly cases: ReadonlyArray<Case & { readonly actual: Outcome }>
}

const listOf = (transitions: FlowTransition | FlowTransition[]): FlowTransition[] =>
  Array.isArray(transitions) ? transitions : [transitions]

/** The effects a transition runs, in XState's order: exit, its actions, entry when it moves. */
function effectsOf(flow: Flow, from: string, { target, actions }: FlowTransition): Effect[] {
  const moves = target !== undefined && target !== from

  return [
    ...(moves ? (flow.states[from]?.exit ?? []) : []),
    ...(actions ?? []),
    ...(moves ? (flow.states[target]?.entry ?? []) : []),
  ]
}

/** Each branch of each event of a state, and none holding after a guarded last branch. */
function casesOf(flow: Flow, name: string, state: FlowState): Case[] {
  const { invoke } = state
  const events = [
    ...Object.entries(state.on ?? {}),
    ...(invoke === undefined ? [] : [['onDone', invoke.onDone] as const]),
    ...(invoke?.onError === undefined ? [] : [['onError', invoke.onError] as const]),
  ]

  return events.flatMap(([event, transitions]) => {
    const list = listOf(transitions)
    const none = { handled: false, state: name, effects: [] }

    return [
      ...list.map((branch, index) => ({
        label: `${name} ${event}[${index}]`,
        event,
        holding: branch.guard,
        expected: {
          handled: true,
          state: branch.target ?? name,
          effects: effectsOf(flow, name, branch),
        },
      })),
      ...(list.at(-1)?.guard === undefined
        ? []
        : [{ label: `${name} ${event}[none]`, event, holding: undefined, expected: none }]),
    ]
  })
}

/** Every case of the flow, whether the walk reaches its state or not. */
export const casesOfFlow = (flow: Flow): Case[] =>
  Object.entries(flow.states).flatMap(([name, state]) => casesOf(flow, name, state))

type Machine = ReturnType<typeof machineOf>

/** The event XState takes for a case: the anchor's or platform's, or the invoke's outcome. */
function eventOf(machine: Machine, state: string, event: string): AnyEventObject {
  const id = machine.states[state]?.invoke[0]?.id ?? `no invoke in ${state}`

  switch (event) {
    case 'onDone':
      return { type: `xstate.done.actor.${id}`, output: undefined, actorId: id }
    case 'onError':
      return {
        type: `xstate.error.actor.${id}`,
        error: new Error('the action failed'),
        actorId: id,
      }
    default:
      return { type: event }
  }
}

const isEffect = ({ type }: { readonly type: string }): boolean =>
  type === 'show' || type === 'navigate'

export function walk(flow: Flow): Walked {
  const holds = new Set<string>()
  const machine = machineOf(flow, holds)
  const [first] = initialTransition(machine)
  const reached = new Map<string, SnapshotFrom<Machine>>()
  const cases: Array<Case & { readonly actual: Outcome }> = []

  reached.set(String(first.value), first)

  for (const [name, snapshot] of reached) {
    const state = flow.states[name]

    for (const each of state === undefined ? [] : casesOf(flow, name, state)) {
      const event = eventOf(machine, name, each.event)

      holds.clear()

      if (each.holding !== undefined) {
        holds.add(each.holding)
      }

      const handled = snapshot.can(event)
      const [next, actions] = transition(machine, snapshot, event)
      const effects = actions.filter(isEffect).map(({ type, params }) => ({ type, params }))

      cases.push({ ...each, actual: { handled, state: String(next.value), effects } })

      if (!reached.has(String(next.value))) {
        reached.set(String(next.value), next)
      }
    }
  }

  return { visited: [...reached.keys()], cases }
}
