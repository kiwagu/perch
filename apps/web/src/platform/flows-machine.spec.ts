/**
 * Each screen's flow is a machine XState runs as written, as each binding is a route the
 * router matches (`routes-router.spec.ts`): the walk (`flows-walk/`) reaches every
 * state of the flow, a parallel state's regions and their states included, and every
 * transition it takes lands where its `target` says (a transition without one stays) with the
 * contract's effects, every guarded branch with its guard holding. Where the app has a
 * machine of its own for a screen, its config is the flow: the same initial state, states,
 * final states, parallel states with the same regions and initial states, events with their
 * targets and guard names, invoke sources, and the contract's effects on the same
 * transitions; the app adds actions of its own (an `assign`), and its `input` is the app's,
 * but no mechanism the flow has no counterpart for (an eventless or delayed transition,
 * nesting beyond a parallel state's regions, history states, transitions on the root, a
 * re-entry).
 */

import { join } from 'node:path'

import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createMachine } from 'xstate'

import { flowNodes, flowSchema, formatProblem, loadScreens } from '@workspace/ui-contract'

import { createProfileMachine } from '../features/user/application/profile.machine'
import { createSignInMachine } from '../features/user/application/sign-in.machine'
import { SignInService } from '../features/user/application/sign-in.service'

import { fakeSession } from './__fixtures__/session'
import { casesOfFlow, walk } from './flows-walk'

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
    expect([...walk(flow).visited].sort()).toEqual(
      flowNodes(flow)
        .map(({ path }) => path)
        .sort(),
    )
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

/** What the comparison holds of a plain state, of the root or of a region. */
function plainOf(state: Readonly<Record<string, unknown>>) {
  const { invoke } = state

  return {
    final: state['type'] === 'final',
    entry: effectsIn(state['entry']),
    exit: effectsIn(state['exit']),
    on: Object.fromEntries(entriesOf(state['on']).map(([event, of]) => [event, transitionsIn(of)])),
    invoke: isRecord(invoke)
      ? {
          src: invoke['src'],
          onDone: transitionsIn(invoke['onDone']),
          onError: transitionsIn(invoke['onError']),
        }
      : undefined,
  }
}

const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : {}

/**
 * What the comparison holds of a machine config: its initial state and, per state, whether
 * it is final, its entry and exit effects, each event's transitions (target, guard, effects)
 * and its invoke's source and outcomes; for a parallel state, also its regions, each with its
 * initial state and its states, held as plain states are.
 */
function projected(config: unknown) {
  const root = recordOf(config)
  const regionOf = (region: Readonly<Record<string, unknown>>) => ({
    initial: region['initial'],
    states: Object.fromEntries(
      entriesOf(region['states']).map(([name, state]) => [name, plainOf(recordOf(state))]),
    ),
  })

  return {
    initial: root['initial'],
    states: Object.fromEntries(
      entriesOf(root['states']).map(([name, value]) => {
        const state = recordOf(value)

        return [
          name,
          state['type'] === 'parallel'
            ? {
                ...plainOf(state),
                regions: Object.fromEntries(
                  entriesOf(state['states']).map(([region, of]) => [
                    region,
                    regionOf(recordOf(of)),
                  ]),
                ),
              }
            : plainOf(state),
        ]
      }),
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
const IN_A_PARALLEL_STATE = {
  always: 'an eventless transition',
  after: 'a delayed transition',
  initial: 'an initial state of a parallel state',
  invoke: 'an actor of the whole parallel state',
  onDone: 'a transition when every region ends',
}
const IN_A_REGION = {
  always: 'an eventless transition',
  after: 'a delayed transition',
  on: 'transitions in every state of a region',
  entry: 'effects on entering a region',
  exit: 'effects on leaving a region',
  invoke: 'an actor of a whole region',
  onDone: 'a transition when a region ends',
}
const IN_AN_INVOKE = { onSnapshot: "transitions on the actor's snapshots" }
const STATE_TYPES: Readonly<Record<string, string>> = { history: 'a history state' }
const REGION_TYPES: Readonly<Record<string, string>> = {
  parallel: 'a parallel state in a region',
  history: 'a history state',
  final: 'a region that ends',
}
const REGION_STATE_TYPES: Readonly<Record<string, string>> = {
  final: 'a state of a region that ends',
  parallel: 'a parallel state in a region',
  history: 'a history state',
}

const outside = (where: string, what: string): string =>
  `${where}: ${what} is outside the flow subset`

/** The keys of `node` among `mechanisms`, each a mechanism outside the subset at `where`. */
const keysIn = (node: Readonly<Record<string, unknown>>, where: string, mechanisms: object) =>
  Object.entries(mechanisms)
    .filter(([key]) => node[key] !== undefined)
    .map(([key, what]) => outside(where, `${key} (${String(what)})`))

/** The `type` of `node` when it is one of `types`, outside the subset at `where`. */
function typeIn(
  node: Readonly<Record<string, unknown>>,
  where: string,
  types: Readonly<Record<string, string>>,
): string[] {
  const type = String(node['type'])
  const what = types[type]

  return what === undefined ? [] : [outside(where, `type ${type} (${what})`)]
}

const reentriesIn = (transitions: unknown, where: string) =>
  listOf(transitions).flatMap((each, index) =>
    isRecord(each) && each['reenter'] === true
      ? [outside(`${where}[${index}]`, 'reenter (a transition that re-enters its state)')]
      : [],
  )

const eventsIn = (state: Readonly<Record<string, unknown>>, where: string) =>
  entriesOf(state['on']).flatMap(([event, of]) =>
    reentriesIn(of, `${where}.on[${JSON.stringify(event)}]`),
  )

/** What a plain state holds beyond the subset: of the root, or of a region with `types`. */
function plainBeyond(
  state: Readonly<Record<string, unknown>>,
  where: string,
  types: Readonly<Record<string, string>>,
): string[] {
  const { invoke } = state

  return [
    ...keysIn(state, where, IN_A_STATE),
    ...typeIn(state, where, types),
    ...(Array.isArray(invoke) ? [outside(where, 'invoke as a list (several actors)')] : []),
    ...eventsIn(state, where),
    ...(isRecord(invoke)
      ? [
          ...keysIn(invoke, `${where}.invoke`, IN_AN_INVOKE),
          ...reentriesIn(invoke['onDone'], `${where}.invoke.onDone`),
          ...reentriesIn(invoke['onError'], `${where}.invoke.onError`),
        ]
      : []),
  ]
}

/** What a region holds beyond the subset, and each of its states. */
function regionBeyond(region: Readonly<Record<string, unknown>>, where: string): string[] {
  return [
    ...keysIn(region, where, IN_A_REGION),
    ...typeIn(region, where, REGION_TYPES),
    ...(region['type'] === 'parallel'
      ? []
      : entriesOf(region['states']).flatMap(([name, value]) => {
          const state = recordOf(value)
          const at = `${where}.states.${name}`

          return [
            ...plainBeyond(state, at, REGION_STATE_TYPES),
            ...(recordOf(state['meta'])['address'] === undefined
              ? []
              : [outside(at, 'meta.address (an address of a state of a region)')]),
          ]
        })),
  ]
}

/**
 * What a machine config does that the flow subset has no counterpart for, each with where it
 * is: transitions on the root, eventless and delayed transitions, nested states but a parallel
 * state's regions, a parallel state's `initial`, `invoke` or `onDone`, anything of a region but
 * its `initial` and its plain states, a state of a region that ends or carries an address,
 * history states, several invokes, a transition that re-enters its state. The projection does
 * not see these, so an app machine using one is refused here, never compared as equal.
 */
function beyondTheSubset(config: unknown): string[] {
  const root = recordOf(config)

  return [
    ...keysIn(root, '(root)', ON_THE_ROOT),
    ...entriesOf(root['states']).flatMap(([name, value]) => {
      const state = recordOf(value)
      const where = `states.${name}`

      return state['type'] === 'parallel'
        ? [
            ...keysIn(state, where, IN_A_PARALLEL_STATE),
            ...eventsIn(state, where),
            ...entriesOf(state['states']).flatMap(([region, of]) =>
              regionBeyond(recordOf(of), `${where}.states.${region}`),
            ),
          ]
        : plainBeyond(state, where, STATE_TYPES)
    }),
  ]
}

/** The machines the app builds for a screen of the contract, by screen id. */
const APP_MACHINES: Readonly<Record<string, () => { readonly config: unknown }>> = {
  'user.sign-in': () =>
    createSignInMachine(
      new SignInService(
        fakeSession().session,
        { createProfile: () => okAsync(undefined) },
        { createSettings: () => okAsync(undefined) },
      ),
    ),
  'user.profile': () =>
    createProfileMachine({
      profiles: { updateName: () => okAsync(undefined), updateBio: () => okAsync(undefined) },
      signOut: () => okAsync('signed-out' as const),
      values: () => ({
        id: undefined,
        stored: { name: '', bio: '' },
        drafts: { name: '', bio: '' },
      }),
    }),
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
  it('refuses nested and history states, a re-entry and transitions on the root', () => {
    const machine = createMachine({
      initial: 'a',
      on: { 'sample.go-button': '.b' },
      states: {
        a: {
          initial: 'inner',
          states: { inner: {} },
          on: { 'sample.go-button': { target: 'a', reenter: true } },
        },
        b: {
          type: 'parallel',
          states: {
            left: { initial: 'x', states: { x: {} } },
            right: { initial: 'y', states: { y: {} } },
          },
        },
        c: { type: 'history' },
      },
    })

    expect(beyondTheSubset(machine.config)).toEqual([
      `(root): on (transitions in every state) ${OUTSIDE}`,
      `states.a: states (nested states) ${OUTSIDE}`,
      `states.a.on["sample.go-button"][0]: reenter (a transition that re-enters its state) ${OUTSIDE}`,
      `states.c: type history (a history state) ${OUTSIDE}`,
    ])
  })
  it('compares a parallel state by its regions, their initial states and their states', () => {
    const config = {
      initial: 'viewing',
      states: {
        viewing: {
          type: 'parallel',
          on: { 'sample.select': { target: 'selecting' } },
          states: {
            form: {
              initial: 'closed',
              states: {
                closed: { on: { 'sample.toggle-button': { target: 'open' } } },
                open: { on: { 'sample.toggle-button': { target: 'closed' } } },
              },
            },
            notes: {
              initial: 'idle',
              states: {
                idle: { on: { 'sample.add-button': { target: 'adding' } } },
                adding: { invoke: { src: 'note.createNote', onDone: { target: 'idle' } } },
              },
            },
          },
        },
        selecting: {
          invoke: { src: 'platform.organisations.select', onDone: { target: 'viewing.form.open' } },
        },
      },
    } as const
    const flow = flowSchema.parse(config)
    const machine = createMachine(config)
    const opened = createMachine({
      ...config,
      states: {
        ...config.states,
        viewing: {
          ...config.states.viewing,
          states: {
            ...config.states.viewing.states,
            form: { ...config.states.viewing.states.form, initial: 'open' },
          },
        },
      },
    })

    expect(beyondTheSubset(machine.config)).toEqual([])
    expect(projected(machine.config)).toEqual(projected(flow))
    expect(projected(opened.config)).not.toEqual(projected(flow))
  })
  it('refuses what a parallel state, a region or a state of a region holds beyond the subset', () => {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          initial: 'left',
          invoke: { src: 'platform.organisations.select' },
          onDone: { target: 'b' },
          states: {
            left: {
              initial: 'x',
              on: { 'sample.go-button': { target: '.y' } },
              states: {
                x: { initial: 'inner', states: { inner: {} } },
                y: { type: 'final' },
                z: { meta: { address: { path: '/org' } } },
              },
            },
            right: { type: 'parallel', states: { one: {}, two: {} } },
          },
        },
        b: { type: 'final' },
      },
    })

    expect(beyondTheSubset(machine.config)).toEqual([
      `states.a: initial (an initial state of a parallel state) ${OUTSIDE}`,
      `states.a: invoke (an actor of the whole parallel state) ${OUTSIDE}`,
      `states.a: onDone (a transition when every region ends) ${OUTSIDE}`,
      `states.a.states.left: on (transitions in every state of a region) ${OUTSIDE}`,
      `states.a.states.left.states.x: states (nested states) ${OUTSIDE}`,
      `states.a.states.left.states.y: type final (a state of a region that ends) ${OUTSIDE}`,
      `states.a.states.left.states.z: meta.address (an address of a state of a region) ${OUTSIDE}`,
      `states.a.states.right: type parallel (a parallel state in a region) ${OUTSIDE}`,
    ])
  })
})
