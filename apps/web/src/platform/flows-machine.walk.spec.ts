import { describe, expect, it } from 'vitest'

import { type Flow, flowSchema } from '@workspace/ui-contract'

import { casesOfFlow, machineOf, walk } from './flows-machine.walk'

const show = (codes: string[]) =>
  ({ type: 'show', params: { anchor: 'sample.notice-message', codes } }) as const

/** A flow of the subset, parsed as the contract parses one. */
const flowOf = (flow: unknown): Flow => flowSchema.parse(flow)

const SIGNING = flowOf({
  initial: 'form',
  states: {
    form: { on: { 'sample.submit-button': { target: 'signing-in' } } },
    'signing-in': {
      invoke: {
        src: 'platform.sign-in',
        onDone: { target: 'done', actions: [show(['welcome'])] },
        onError: { target: 'form', actions: [show(['failed'])] },
      },
    },
    done: { type: 'final' },
  },
})

const outcomesOf = (flow: Flow) =>
  walk(flow).cases.map(({ label, actual }) => [label, actual.handled, actual.state])

describe('the walk of a flow', () => {
  it("raises an invoke's done and error events under the id XState gives the invoke", () => {
    expect(machineOf(SIGNING, new Set()).states['signing-in']?.invoke[0]?.id).toBe(
      '0.(machine).signing-in',
    )
    expect(walk(SIGNING)).toMatchObject({
      visited: ['form', 'signing-in', 'done'],
      cases: [
        { label: 'form sample.submit-button[0]', actual: { state: 'signing-in', effects: [] } },
        { label: 'signing-in onDone[0]', actual: { state: 'done', effects: [show(['welcome'])] } },
        { label: 'signing-in onError[0]', actual: { state: 'form', effects: [show(['failed'])] } },
      ],
    })
  })
  it('takes each guarded branch with its own guard, and none after a guarded last', () => {
    const flow = flowOf({
      initial: 'a',
      meta: { guards: { first: 'the first holds', second: 'the second holds' } },
      states: {
        a: {
          on: {
            'sample.go-button': [
              { guard: 'first', target: 'b' },
              { guard: 'second', target: 'c' },
            ],
          },
        },
        b: { type: 'final' },
        c: { type: 'final' },
      },
    })

    expect(outcomesOf(flow)).toEqual([
      ['a sample.go-button[0]', true, 'b'],
      ['a sample.go-button[1]', true, 'c'],
      ['a sample.go-button[none]', false, 'a'],
    ])
    expect(casesOfFlow(flow).map(({ label }) => label)).toEqual([
      'a sample.go-button[0]',
      'a sample.go-button[1]',
      'a sample.go-button[none]',
    ])
  })
  it('tells a branch that an earlier one with the same guard shadows', () => {
    const flow = flowOf({
      initial: 'a',
      meta: { guards: { first: 'the first holds' } },
      states: {
        a: {
          on: {
            'sample.go-button': [
              { guard: 'first', target: 'b' },
              { guard: 'first', target: 'c' },
              { target: 'a' },
            ],
          },
        },
        b: { type: 'final' },
        c: { type: 'final' },
      },
    })
    const shadowed = walk(flow).cases.find(({ label }) => label === 'a sample.go-button[1]')

    expect(shadowed).toMatchObject({ expected: { state: 'c' }, actual: { state: 'b' } })
  })
  it("expects the effects in XState's order: exit, the transition's, entry; none on staying", () => {
    const flow = flowOf({
      initial: 'a',
      states: {
        a: {
          exit: [show(['left'])],
          on: {
            'sample.go-button': { target: 'b', actions: [show(['moved'])] },
            'sample.stay-button': { actions: [show(['stayed'])] },
          },
        },
        b: { type: 'final', entry: [show(['entered'])] },
      },
    })

    for (const { label, expected, actual } of walk(flow).cases) {
      expect(actual, label).toEqual(expected)
    }

    expect(walk(flow).cases.map(({ actual }) => actual.effects)).toEqual([
      [show(['left']), show(['moved']), show(['entered'])],
      [show(['stayed'])],
    ])
  })
})
