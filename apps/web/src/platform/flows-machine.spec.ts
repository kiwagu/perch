/**
 * Each screen's flow is a machine XState runs as written, as each binding is a route the
 * router matches (`routes-router.spec.ts`): the walk (`flows-machine.walk.ts`) reaches every
 * state of the flow, and every transition it takes lands where its `target` says (a
 * transition without one stays) with the contract's effects, every guarded branch with its
 * guard holding. Where the app has a machine of its own for a screen, its config is the
 * flow: the same initial state, states, final states, events with their targets and guard
 * names, invoke sources, and the contract's effects on the same transitions; the app adds
 * actions of its own (an `assign`), and its `input` is the app's.
 */

import { join } from 'node:path'

import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

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

    expect(projected(machine().config)).toEqual(projected(flow))
  })
})
