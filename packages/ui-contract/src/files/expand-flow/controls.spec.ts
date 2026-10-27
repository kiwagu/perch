import { describe, expect, it } from 'vitest'

import { flowSchema } from '../../schemas'
import type { Control, Failure } from '../derive'

import { expandFlow, type FlowLookups } from '.'

const CODES: Readonly<Record<string, readonly string[]>> = {
  'sample.form.error': ['forbidden', 'title-required', 'failed'],
  'sample.other.error': ['not-allowed', 'failed'],
  'app-shell.notice-message': ['removed'],
}

const FAILURES: Readonly<Record<string, Failure>> = {
  'thing.createThing': { codes: ['forbidden', 'title-required', 'failed'], params: {} },
  'platform.things.remove': { codes: ['not-allowed', 'failed'], params: {} },
  'platform.things.open': { codes: [], params: {} },
}

const ADD: Control = {
  anchor: 'sample.form.add-button',
  src: 'thing.createThing',
  input: { title: 'sample.form.title-input' },
  error: 'sample.form.error',
}

const REMOVE: Control = {
  anchor: 'sample.list.remove-button',
  src: 'platform.things.remove',
  input: { id: 'sample.list.item' },
  error: undefined,
}

const OPEN: Control = {
  anchor: 'sample.list.open-button',
  src: 'platform.things.open',
  input: undefined,
  error: undefined,
}

const lookups = (controls: readonly Control[]): FlowLookups => ({
  codesOf: (anchor) => CODES[anchor],
  failureOf: (action) => FAILURES[action],
  controls,
  screen: 'sample',
  toast: undefined,
})

/** A flow whose root is one parallel state `viewing` with the regions `regions`. */
const viewing = (regions: Record<string, unknown>) => ({
  initial: 'viewing',
  states: { viewing: { type: 'parallel', states: regions } },
})

const OTHER = { initial: 'idle', states: { idle: {} } }

/** The regions of `viewing` once `flow` is expanded with `controls`, and the issues. */
function regionsOf(flow: unknown, controls: readonly Control[]) {
  const expanded = expandFlow(flow, lookups(controls))
  const states = (expanded.flow as { states: { viewing: { states: Record<string, unknown> } } })
    .states

  return { regions: states.viewing.states, issues: expanded.issues }
}

const ADD_REGION = {
  description:
    'Derived from the binding of sample.form.add-button: it runs thing.createThing, and the region waits in running until it ends.',
  initial: 'idle',
  states: {
    idle: { on: { 'sample.form.add-button': { target: 'running' } } },
    running: {
      invoke: {
        src: 'thing.createThing',
        input: { title: 'sample.form.title-input' },
        onDone: {
          target: 'idle',
          description: 'The controls whose values the action took are emptied.',
        },
        onError: {
          target: 'idle',
          actions: [
            {
              type: 'show',
              params: {
                anchor: 'sample.form.error',
                codes: ['forbidden', 'title-required', 'failed'],
              },
            },
          ],
        },
      },
    },
  },
}

describe('the region of a button bound to one action', () => {
  it('is derived for a button no state handles, after the regions written', () => {
    expect(regionsOf(viewing({ other: OTHER }), [ADD])).toEqual({
      regions: { other: OTHER, 'form-add': ADD_REGION },
      issues: [],
    })
  })

  it('is not derived for a button the flow handles, nor in a flow without one parallel state', () => {
    const handled = {
      initial: 'idle',
      states: { idle: { on: { 'sample.form.add-button': 'idle' } } },
    }

    expect(regionsOf(viewing({ other: handled }), [ADD]).regions).toEqual({
      other: {
        initial: 'idle',
        states: { idle: { on: { 'sample.form.add-button': { target: 'idle' } } } },
      },
    })

    const flat = { initial: 'viewing', states: { viewing: {} } }

    expect(expandFlow(flat, lookups([ADD]))).toEqual({
      flow: flat,
      issues: [],
      toasts: [],
      writtenToasts: [],
    })
  })

  it('is written as by: <button> with the outcomes the screen decides, the rest derived', () => {
    const { regions, issues } = regionsOf(
      viewing({
        list: {
          by: 'sample.list.remove-button',
          onDone: { actions: [{ show: { 'app-shell.notice-message': ['removed'] } }] },
          onError: {
            description: 'Under the other form.',
            actions: [{ show: 'sample.other.error' }],
          },
        },
        form: { by: 'sample.form.add-button', description: 'The new thing.' },
      }),
      [ADD, REMOVE],
    )

    expect(issues).toEqual([])
    expect(regions['form']).toEqual({ ...ADD_REGION, description: 'The new thing.' })
    expect(regions['list']).toMatchObject({
      initial: 'idle',
      states: {
        idle: { on: { 'sample.list.remove-button': { target: 'running' } } },
        running: {
          invoke: {
            src: 'platform.things.remove',
            input: { id: 'sample.list.item' },
            onDone: {
              target: 'idle',
              actions: [
                {
                  type: 'show',
                  params: { anchor: 'app-shell.notice-message', codes: ['removed'] },
                },
              ],
            },
            onError: {
              target: 'idle',
              description: 'Under the other form.',
              actions: [
                {
                  type: 'show',
                  params: { anchor: 'sample.other.error', codes: ['not-allowed', 'failed'] },
                },
              ],
            },
          },
        },
      },
    })
    expect(Object.keys(regions)).toEqual(['list', 'form'])
  })

  it('keeps a target an outcome names, and names a mistake inside an outcome once, at its place', () => {
    const { regions, issues } = regionsOf(
      viewing({
        list: {
          by: 'sample.list.remove-button',
          onDone: '#sample.done',
          onError: { actions: [{ show: 'sample.list.nothing' }] },
        },
      }),
      [REMOVE],
    )

    expect(regions['list']).toMatchObject({
      states: { running: { invoke: { onDone: { target: '#sample.done' } } } },
    })
    expect(issues).toEqual([
      {
        at: ['flow', 'states', 'viewing', 'states', 'list', 'onError', 'actions', 0, 'show'],
        message: 'no screen declares the anchor sample.list.nothing',
      },
    ])
  })

  it('is not derived for a button a pattern handles once expanded', () => {
    const draft = {
      pattern: 'draft',
      input: 'sample.form.add-button',
      stored: 'model.thing.title',
      guard: 'titleIsStored',
    }

    expect(Object.keys(regionsOf(viewing({ other: OTHER, form: draft }), [ADD]).regions)).toEqual([
      'other',
      'form',
    ])
  })

  it('makes a flow the canonical schema takes', () => {
    const { flow } = expandFlow(
      viewing({ other: OTHER, list: { by: 'sample.list.remove-button', onError: 'idle' } }),
      lookups([ADD, REMOVE, OPEN]),
    )

    expect(flowSchema.safeParse(flow).success).toBe(true)
  })

  it('goes back to idle with nothing shown for an action that fails with no code', () => {
    expect(regionsOf(viewing({ other: OTHER }), [OPEN]).regions['list-open']).toMatchObject({
      states: { running: { invoke: { onDone: { target: 'idle' }, onError: { target: 'idle' } } } },
    })
  })

  it('names what keeps it from being derived or written', () => {
    expect(regionsOf(viewing({ other: OTHER }), [REMOVE]).issues).toEqual([
      {
        at: ['anchors', 'sample.list.remove-button', 'binding'],
        message:
          'sample.list.remove-button runs platform.things.remove, whose failure shows not-allowed, failed, and the screen declares no sample.list.error: declare it, or write the region with by: sample.list.remove-button and its onError',
      },
    ])
    expect(regionsOf(viewing({ 'form-add': OTHER }), [ADD]).issues).toEqual([
      {
        at: ['anchors', 'sample.form.add-button', 'binding'],
        message:
          'the region derived for sample.form.add-button is named form-add, which the parallel state viewing has already: write it as a region with by: sample.form.add-button',
      },
    ])
    expect(regionsOf(viewing({ list: { by: 'sample.list.item' } }), [ADD]).issues).toEqual([
      {
        at: ['flow', 'states', 'viewing', 'states', 'list', 'by'],
        message: 'sample.list.item is not a button of the screen bound to one action',
      },
    ])
    expect(
      regionsOf(viewing({ list: { by: 'sample.list.remove-button', as: 'removing' } }), [REMOVE])
        .issues,
    ).toEqual([expect.objectContaining({ at: ['flow', 'states', 'viewing', 'states', 'list'] })])
  })
})
