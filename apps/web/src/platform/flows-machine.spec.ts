/**
 * Each screen's flow is a machine XState runs as written, as each binding is a route the
 * router matches (`routes-router.spec.ts`): the walk (`flows-machine.walk.ts`) reaches every
 * state of the flow, and every transition it takes lands where its `target` says (a
 * transition without one stays) with the contract's effects, every guarded branch with its
 * guard holding. Where the app has a machine of its own for a screen, its config is the
 * flow: the same initial state, states, final states, events with their targets and guard
 * names, invoke sources, and the contract's effects on the same transitions; the app adds
 * actions of its own (an `assign`), and its `input` is the app's, but no mechanism the flow
 * has no counterpart for (an eventless or delayed transition, nested, parallel or history
 * states, transitions on the root, a re-entry).
 */

import { join } from 'node:path'

import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createMachine } from 'xstate'

import { formatProblem, loadScreens } from '@workspace/ui-contract'

import { createSignInMachine } from '../features/user/application/sign-in.machine'
import { SignInService } from '../features/user/application/sign-in.service'

import { fakeSession } from './__fixtures__/session'
import { casesOfFlow, walk } from './flows-machine.walk'

const ROOT = join(import.meta.dirname, '../../../..')

const { screens, problems } = loadScreens(ROOT)
const flows = (screens?.screens ?? []).flatMap(({ id, flow }) =>
  flow === undefined ? [] : [[id, flow] as const],
)

describe('the flows of the contract in XState', () => {
  it('read a contract with flows', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(flows.length).toBeGreaterThan(0)
  })

  it.each(flows)('%s reaches every state', (_, flow) => {
    expect([...walk(flow).visited].sort()).toEqual(Object.keys(flow.states).sort())
  })

  it.each(flows)('%s takes every transition to its target with its effects', (_, flow) => {
    const { cases } = walk(flow)

    expect(cases.map(({ label }) => label).sort()).toEqual(
      casesOfFlow(flow)
        .map(({ label }) => label)
        .sort(),
    )

    for (const { label, expected, actual } of cases) {
      expect(actual, label).toEqual(expected)
    }
  })
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const entriesOf = (value: unknown): [string, unknown][] =>
  isRecord(value) ? Object.entries(value) : []

/** One transition or a list of them, as a list; a string is a target alone. */
function listOf(value: unknown): readonly unknown[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value.map((each: unknown) => each) : [value]
}

/** The contract's effects among actions: the app's own (`assign`, a named action) left out. */
const effectsIn = (actions: unknown) =>
  listOf(actions)
    .filter(isRecord)
    .filter(({ type }) => type === 'show' || type === 'navigate')
    .map(({ type, params }) => ({ type, params }))

const transitionsIn = (value: unknown) =>
  listOf(value).map((each) =>
    isRecord(each)
      ? { target: each['target'], guard: each['guard'], effects: effectsIn(each['actions']) }
      : { target: each, guard: undefined, effects: [] },
  )

/**
 * What the comparison holds of a machine config: its initial state and, per state, whether
 * it is final, its entry and exit effects, each event's transitions (target, guard, effects)
 * and its invoke's source and outcomes.
 */
function projected(config: unknown) {
  const root = isRecord(config) ? config : {}
  const stateOf = (state: Readonly<Record<string, unknown>>) => {
    const { invoke } = state

    return {
      final: state['type'] === 'final',
      entry: effectsIn(state['entry']),
      exit: effectsIn(state['exit']),
      on: Object.fromEntries(
        entriesOf(state['on']).map(([event, of]) => [event, transitionsIn(of)]),
      ),
      invoke: isRecord(invoke)
        ? {
            src: invoke['src'],
            onDone: transitionsIn(invoke['onDone']),
            onError: transitionsIn(invoke['onError']),
          }
        : undefined,
    }
  }

  return {
    initial: root['initial'],
    states: Object.fromEntries(
      entriesOf(root['states']).map(([name, state]) => [
        name,
        stateOf(isRecord(state) ? state : {}),
      ]),
    ),
  }
}

/** What a mechanism outside the flow subset is, by the key of a config that holds it. */
const ON_THE_ROOT = {
  on: 'transitions in every state',
  always: 'an eventless transition',
  after: 'a delayed transition',
  invoke: 'an actor of the whole machine',
}
const IN_A_STATE = {
  always: 'an eventless transition',
  after: 'a delayed transition',
  states: 'nested states',
  onDone: 'a transition when nested states end',
}
const IN_AN_INVOKE = { onSnapshot: "transitions on the actor's snapshots" }
const STATE_TYPES: Readonly<Record<string, string>> = {
  parallel: 'parallel regions',
  history: 'a history state',
}

const outside = (where: string, what: string): string =>
  `${where}: ${what} is outside the flow subset`

/** The keys of `node` among `mechanisms`, each a mechanism outside the subset at `where`. */
const keysIn = (node: Readonly<Record<string, unknown>>, where: string, mechanisms: object) =>
  Object.entries(mechanisms)
    .filter(([key]) => node[key] !== undefined)
    .map(([key, what]) => outside(where, `${key} (${String(what)})`))

const reentriesIn = (transitions: unknown, where: string) =>
  listOf(transitions).flatMap((each, index) =>
    isRecord(each) && each['reenter'] === true
      ? [outside(`${where}[${index}]`, 'reenter (a transition that re-enters its state)')]
      : [],
  )

/**
 * What a machine config does that the flow subset has no counterpart for, each with where it
 * is: transitions on the root, eventless and delayed transitions, nested, parallel and
 * history states, several invokes, a transition that re-enters its state. The projection
 * does not see these, so an app machine using one is refused here, never compared as equal.
 */
function beyondTheSubset(config: unknown): string[] {
  const root = isRecord(config) ? config : {}

  return [
    ...keysIn(root, '(root)', ON_THE_ROOT),
    ...entriesOf(root['states']).flatMap(([name, value]) => {
      const state = isRecord(value) ? value : {}
      const where = `states.${name}`
      const type = STATE_TYPES[String(state['type'])]
      const { invoke } = state

      return [
        ...keysIn(state, where, IN_A_STATE),
        ...(type === undefined ? [] : [outside(where, `type ${String(state['type'])} (${type})`)]),
        ...(Array.isArray(invoke) ? [outside(where, 'invoke as a list (several actors)')] : []),
        ...entriesOf(state['on']).flatMap(([event, of]) =>
          reentriesIn(of, `${where}.on[${JSON.stringify(event)}]`),
        ),
        ...(isRecord(invoke)
          ? [
              ...keysIn(invoke, `${where}.invoke`, IN_AN_INVOKE),
              ...reentriesIn(invoke['onDone'], `${where}.invoke.onDone`),
              ...reentriesIn(invoke['onError'], `${where}.invoke.onError`),
            ]
          : []),
      ]
    }),
  ]
}

/** The machines the app builds for a screen of the contract, by screen id. */
const APP_MACHINES: Readonly<Record<string, () => { readonly config: unknown }>> = {
  'user.sign-in': () =>
    createSignInMachine(
      new SignInService(fakeSession().session, { createProfile: () => okAsync(undefined) }),
    ),
}

describe('the machines of the app', () => {
  it.each(Object.entries(APP_MACHINES))('%s is the flow of its screen', (id, machine) => {
    const flow =
      flows.find(([screen]) => screen === id)?.[1] ?? expect.unreachable(`a flow of ${id}`)

    const { config } = machine()

    expect(beyondTheSubset(config), `what ${id} does beyond its flow`).toEqual([])
    expect(projected(config)).toEqual(projected(flow))
  })
})

describe('the comparison of a machine with its flow', () => {
  const OUTSIDE = 'is outside the flow subset'

  it('refuses an eventless transition and a delayed one', () => {
    const always = createMachine({
      initial: 'a',
      states: { a: { always: { target: 'b' } }, b: {} },
    })
    const after = createMachine({
      initial: 'a',
      states: { a: { after: { 100: { target: 'b' } } }, b: {} },
    })

    expect(beyondTheSubset(always.config)).toEqual([
      `states.a: always (an eventless transition) ${OUTSIDE}`,
    ])
    expect(beyondTheSubset(after.config)).toEqual([
      `states.a: after (a delayed transition) ${OUTSIDE}`,
    ])
  })
  it('refuses nested, parallel and history states, a re-entry and transitions on the root', () => {
    const machine = createMachine({
      initial: 'a',
      on: { 'sample.go-button': '.b' },
      states: {
        a: {
          initial: 'inner',
          states: { inner: {} },
          on: { 'sample.go-button': { target: 'a', reenter: true } },
        },
        b: { type: 'parallel', states: { left: {}, right: {} } },
        c: { type: 'history' },
      },
    })

    expect(beyondTheSubset(machine.config)).toEqual([
      `(root): on (transitions in every state) ${OUTSIDE}`,
      `states.a: states (nested states) ${OUTSIDE}`,
      `states.a.on["sample.go-button"][0]: reenter (a transition that re-enters its state) ${OUTSIDE}`,
      `states.b: states (nested states) ${OUTSIDE}`,
      `states.b: type parallel (parallel regions) ${OUTSIDE}`,
      `states.c: type history (a history state) ${OUTSIDE}`,
    ])
  })
})
