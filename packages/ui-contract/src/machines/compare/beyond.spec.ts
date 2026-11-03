import { describe, expect, it } from 'vitest'
import { createMachine } from 'xstate'

import { beyondTheSubset } from './beyond'

describe('what a machine does beyond the flow subset', () => {
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
  it('takes the anchors a state of a region renders, its meta beyond an address', () => {
    const machine = createMachine({
      initial: 'a',
      states: {
        a: {
          type: 'parallel',
          meta: { renders: ['sample.go-button'] },
          states: {
            left: {
              initial: 'x',
              states: { x: { meta: { renders: ['sample.go-button'] } } },
            },
            right: { initial: 'y', states: { y: {} } },
          },
        },
      },
    })

    expect(beyondTheSubset(machine.config)).toEqual([])
  })
})
