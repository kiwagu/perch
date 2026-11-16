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

/** The last version whose regions keep their area's error after a success, as the specs below read. */
const FOUR = 4

const lookups = (controls: readonly Control[], edition = FOUR): FlowLookups => ({
  codesOf: (anchor) => CODES[anchor],
  failureOf: (action) => FAILURES[action],
  controls,
  screen: 'sample',
  toast: undefined,
  platformToasts: {},
  edition,
})

/** A flow whose root is one parallel state `viewing` with the regions `regions`. */
const viewing = (regions: Record<string, unknown>) => ({
  initial: 'viewing',
  states: { viewing: { type: 'parallel', states: regions } },
})

const OTHER = { initial: 'idle', states: { idle: {} } }

/** The regions of `viewing` once `flow` is expanded with `controls` at `edition`, and the issues. */
function regionsOf(flow: unknown, controls: readonly Control[], edition = FOUR) {
  const expanded = expandFlow(flow, lookups(controls, edition))
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

  it('passes read: false, that nothing reads after the action, on to its invoke', () => {
    const { regions, issues } = regionsOf(
      viewing({ other: OTHER, form: { by: 'sample.form.add-button', read: false } }),
      [ADD],
    )

    expect(issues).toEqual([])
    expect(regions['form']).toMatchObject({
      states: { running: { invoke: { src: 'thing.createThing', read: false } } },
    })
    expect(regionsOf(viewing({ other: OTHER }), [ADD]).regions['form-add']).not.toMatchObject({
      states: { running: { invoke: { read: false } } },
    })
  })

  it('keeps read: false on a branch of an outcome it writes, that nothing reads after that outcome', () => {
    const { regions, issues } = regionsOf(
      viewing({
        other: OTHER,
        form: {
          by: 'sample.form.add-button',
          onDone: [{ guard: 'ownChange', read: false }, { actions: [{ read: 'sample.list' }] }],
          onError: { read: false, actions: [{ show: 'sample.form.error' }] },
        },
      }),
      [ADD],
    )

    expect(issues).toEqual([])
    expect(regions['form']).toMatchObject({
      states: {
        running: {
          invoke: {
            src: 'thing.createThing',
            onDone: [
              { target: 'idle', guard: 'ownChange', read: false },
              { target: 'idle', actions: [{ type: 'read', params: { anchor: 'sample.list' } }] },
            ],
            onError: {
              target: 'idle',
              read: false,
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
    })
    expect(regions['form']).not.toMatchObject({
      states: { running: { invoke: { read: false } } },
    })
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

describe("from version 5, the success of a button's region and its area's error", () => {
  const FIVE = 5
  const CLEAR = { type: 'clear', params: { anchor: 'sample.form.error' } }
  const READ = { type: 'read', params: { anchor: 'sample.list' } }
  const at5 = (regions: Record<string, unknown>, controls: readonly Control[]) =>
    regionsOf(viewing(regions), controls, FIVE)
  const onDoneOf = (region: unknown): unknown =>
    (region as { states: { running: { invoke: { onDone: unknown } } } }).states.running.invoke
      .onDone
  const DERIVED = `derived: a success clears its area's error, sample.form.error; leave it out`

  it('clears the error of the part first, on the outcome a region written by its button writes', () => {
    const written = { by: 'sample.form.add-button', onDone: { actions: [{ read: 'sample.list' }] } }

    expect(at5({ other: OTHER, form: written }, [ADD])).toEqual({
      regions: {
        other: OTHER,
        form: {
          ...ADD_REGION,
          states: {
            ...ADD_REGION.states,
            running: {
              invoke: {
                ...ADD_REGION.states.running.invoke,
                onDone: { target: 'idle', actions: [CLEAR, READ] },
              },
            },
          },
        },
      },
      issues: [],
    })
    // As written, the outcome clears nothing, and at version 4 it stays so.
    expect(written.onDone.actions).not.toContainEqual({ clear: 'sample.form.error' })
    expect(
      onDoneOf(regionsOf(viewing({ other: OTHER, form: written }), [ADD]).regions['form']),
    ).toEqual({ target: 'idle', actions: [READ] })
  })

  it('clears it on the derived outcome, of a region written by its button or derived', () => {
    const done = {
      target: 'idle',
      description: 'The controls whose values the action took are emptied.',
      actions: [CLEAR],
    }

    expect(onDoneOf(at5({ other: OTHER }, [ADD]).regions['form-add'])).toEqual(done)
    expect(
      onDoneOf(at5({ form: { by: 'sample.form.add-button' } }, [ADD]).regions['form']),
    ).toEqual(done)
    expect(onDoneOf(regionsOf(viewing({ other: OTHER }), [ADD]).regions['form-add'])).toEqual({
      target: 'idle',
      description: 'The controls whose values the action took are emptied.',
    })
  })

  it('clears it on every branch of the outcome: a guarded one, one that says read: false, a target alone', () => {
    const guarded = at5(
      {
        other: OTHER,
        form: {
          by: 'sample.form.add-button',
          onDone: [{ guard: 'ownChange', read: false }, { actions: [{ read: 'sample.list' }] }],
        },
      },
      [ADD],
    )

    expect(guarded.issues).toEqual([])
    expect(onDoneOf(guarded.regions['form'])).toEqual([
      { target: 'idle', guard: 'ownChange', read: false, actions: [CLEAR] },
      { target: 'idle', actions: [CLEAR, READ] },
    ])
    expect(
      onDoneOf(
        at5({ form: { by: 'sample.form.add-button', onDone: '#sample.done' } }, [ADD]).regions[
          'form'
        ],
      ),
    ).toEqual({ target: '#sample.done', actions: [CLEAR] })
  })

  it('leaves a branch that shows on the error as it is, and the outcome of a failure', () => {
    const show = { type: 'show', params: { anchor: 'sample.form.error', codes: ['forbidden'] } }
    const { regions, issues } = at5(
      {
        form: {
          by: 'sample.form.add-button',
          onDone: [
            { guard: 'ownChange', actions: [{ show: { 'sample.form.error': ['forbidden'] } }] },
            { actions: [{ read: 'sample.list' }] },
          ],
        },
      },
      [ADD],
    )

    expect(issues).toEqual([])
    expect(onDoneOf(regions['form'])).toEqual([
      { target: 'idle', guard: 'ownChange', actions: [show] },
      { target: 'idle', actions: [CLEAR, READ] },
    ])
    expect(regions['form']).toMatchObject({
      states: { running: { invoke: { onError: ADD_REGION.states.running.invoke.onError } } },
    })
  })

  it('gives none to the region of a button whose part has no error', () => {
    const { regions, issues } = at5(
      {
        list: {
          by: 'sample.list.remove-button',
          onDone: { actions: [{ read: 'sample.list' }] },
          onError: { actions: [{ show: 'sample.other.error' }] },
        },
      },
      [REMOVE, OPEN],
    )

    expect(issues).toEqual([])
    expect(onDoneOf(regions['list'])).toEqual({ target: 'idle', actions: [READ] })
    expect(onDoneOf(regions['list-open'])).toEqual({ target: 'idle' })
  })

  it('keeps a clear of another anchor after the derived one, and leaves a region written in full as it is', () => {
    const full = {
      initial: 'idle',
      states: {
        idle: { on: { 'sample.form.add-button': 'running' } },
        running: {
          invoke: {
            src: 'thing.createThing',
            onDone: { target: 'idle', actions: [{ clear: 'sample.form.error' }] },
            onError: 'idle',
          },
        },
      },
    }
    const { regions, issues } = at5(
      {
        form: {
          by: 'sample.form.add-button',
          onDone: { actions: [{ clear: 'sample.form.title-input' }] },
        },
        written: full,
      },
      [ADD],
    )
    const titleCleared = { type: 'clear', params: { anchor: 'sample.form.title-input' } }

    expect(issues).toEqual([])
    expect(onDoneOf(regions['form'])).toEqual({ target: 'idle', actions: [CLEAR, titleCleared] })
    expect(onDoneOf(regions['written'])).toEqual({ target: 'idle', actions: [CLEAR] })
  })

  it('refuses a clear of the error a branch of the outcome writes, in either form, at its place', () => {
    const region = ['flow', 'states', 'viewing', 'states', 'form', 'onDone']

    expect(
      at5(
        {
          form: {
            by: 'sample.form.add-button',
            onDone: { actions: [{ clear: 'sample.form.error' }, { read: 'sample.list' }] },
          },
        },
        [ADD],
      ).issues,
    ).toEqual([{ at: [...region, 'actions', 0], message: DERIVED }])
    expect(
      at5(
        {
          form: {
            by: 'sample.form.add-button',
            onDone: [
              { guard: 'ownChange', read: false },
              { actions: [{ read: 'sample.list' }, CLEAR] },
            ],
          },
        },
        [ADD],
      ).issues,
    ).toEqual([{ at: [...region, 1, 'actions', 1], message: DERIVED }])
    // At version 4 the same clear is the screen's own.
    expect(
      regionsOf(
        viewing({
          form: {
            by: 'sample.form.add-button',
            onDone: { actions: [{ clear: 'sample.form.error' }] },
          },
        }),
        [ADD],
      ),
    ).toMatchObject({
      issues: [],
      regions: { form: { states: { running: { invoke: { onDone: { actions: [CLEAR] } } } } } },
    })
  })

  it('makes a flow the canonical schema takes', () => {
    const { flow, issues } = expandFlow(
      viewing({
        other: OTHER,
        list: {
          by: 'sample.list.remove-button',
          onError: { actions: [{ show: 'sample.other.error' }] },
        },
      }),
      lookups([ADD, REMOVE, OPEN], FIVE),
    )

    expect(issues).toEqual([])
    expect(flowSchema.safeParse(flow).success).toBe(true)
  })
})
