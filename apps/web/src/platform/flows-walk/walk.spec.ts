import { describe, expect, it } from 'vitest'

import { type Flow, flowSchema } from '@workspace/ui-contract'

import { casesOfFlow } from './cases'
import { machineOf } from './machine'
import { walk } from './walk'

const show = (codes: string[]) =>
  ({ type: 'show', params: { anchor: 'sample.notice-message', codes } }) as const

const clear = { type: 'clear', params: { anchor: 'sample.notice-message' } } as const

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
  it("expects the effects in XState's order: exit, the transition's, entry; none on staying, a clear among them", () => {
    const flow = flowOf({
      initial: 'a',
      states: {
        a: {
          exit: [show(['left'])],
          on: {
            'sample.go-button': { target: 'b', actions: [clear, show(['moved'])] },
            'sample.stay-button': { actions: [show(['stayed']), clear] },
          },
        },
        b: { type: 'final', entry: [show(['entered'])] },
      },
    })

    for (const { label, expected, actual } of walk(flow).cases) {
      expect(actual, label).toEqual(expected)
    }

    expect(walk(flow).cases.map(({ actual }) => actual.effects)).toEqual([
      [show(['left']), clear, show(['moved']), show(['entered'])],
      [show(['stayed']), clear],
    ])
  })
})

/**
 * A screen of two independent areas, as the organisation page has: `viewing` is a parallel
 * state whose own events leave it, the form opens and closes, the notes add through an
 * invoke, a failed create lands with the form open (a deep target from a sibling), and a
 * reset starts both areas again with the form open (a deep target into itself), a restart
 * with every area at its initial (a target into itself by name), and a peek at the notes
 * neither moves nor runs anything, which XState does not count as handled. The form
 * submits in its own area: done, it re-enters `viewing` by the machine's id, every area at
 * its initial state; and the notes leave for `away` by an id target from their idle state.
 */
const AREAS = flowOf({
  id: 'sample',
  initial: 'viewing',
  states: {
    viewing: {
      type: 'parallel',
      entry: [show(['entered'])],
      exit: [show(['left'])],
      on: {
        'sample.select': { target: 'selecting' },
        'sample.create-button': { target: 'creating' },
        'sample.reset-button': { target: 'viewing.form.open', actions: [show(['reset'])] },
        'sample.restart-button': { target: 'viewing', actions: [show(['restarted'])] },
      },
      states: {
        form: {
          initial: 'closed',
          states: {
            closed: {
              exit: [show(['unfolded'])],
              on: { 'sample.toggle-button': { target: 'open' } },
            },
            open: {
              entry: [show(['opened'])],
              on: {
                'sample.toggle-button': { target: 'closed' },
                'sample.submit-button': { target: 'submitting' },
              },
            },
            submitting: {
              invoke: {
                src: 'platform.organisations.create',
                onDone: { target: '#sample.viewing', actions: [show(['created'])] },
                onError: { target: 'open', actions: [show(['refused'])] },
              },
            },
          },
        },
        notes: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                'sample.add-button': { target: 'adding' },
                'sample.leave-button': { target: '#sample.away', actions: [show(['leaving'])] },
                'sample.peek-button': { description: 'Nothing moves and nothing runs.' },
              },
            },
            adding: {
              invoke: {
                src: 'note.createNote',
                onDone: { target: 'idle' },
                onError: { target: 'idle', actions: [show(['failed'])] },
              },
            },
          },
        },
      },
    },
    selecting: { invoke: { src: 'platform.organisations.select', onDone: { target: 'viewing' } } },
    creating: {
      invoke: {
        src: 'platform.organisations.create',
        onDone: { target: 'viewing' },
        onError: { target: 'viewing.form.open', actions: [show(['refused'])] },
      },
    },
    away: { type: 'final' },
  },
})

const at = (form: string, notes: string) => ({ viewing: { form, notes } })

describe('the walk of a flow with a parallel state', () => {
  it("raises a region's invoke outcomes under the id XState gives it", () => {
    const viewing = machineOf(AREAS, new Set()).states['viewing']

    expect(viewing?.states['notes']?.states['adding']?.invoke[0]?.id).toBe(
      '0.sample.viewing.notes.adding',
    )
  })
  it('walks each region on its own, the others at their initial state', () => {
    expect(walk(AREAS).visited).toEqual([
      'viewing',
      'viewing.form',
      'viewing.form.closed',
      'viewing.form.open',
      'viewing.form.submitting',
      'viewing.notes',
      'viewing.notes.idle',
      'viewing.notes.adding',
      'selecting',
      'creating',
      'away',
    ])
  })
  it('lands where XState does, with the effects in its order, as the flow expects', () => {
    const { cases } = walk(AREAS)

    expect(cases.map(({ label, actual }) => [label, actual.state, actual.effects])).toEqual([
      ['viewing sample.select[0]', 'selecting', [show(['unfolded']), show(['left'])]],
      ['viewing sample.create-button[0]', 'creating', [show(['unfolded']), show(['left'])]],
      [
        'viewing sample.reset-button[0]',
        at('open', 'idle'),
        [show(['unfolded']), show(['reset']), show(['opened'])],
      ],
      [
        'viewing sample.restart-button[0]',
        at('closed', 'idle'),
        [show(['unfolded']), show(['restarted'])],
      ],
      [
        'viewing.form.closed sample.toggle-button[0]',
        at('open', 'idle'),
        [show(['unfolded']), show(['opened'])],
      ],
      ['viewing.form.open sample.toggle-button[0]', at('closed', 'idle'), []],
      ['viewing.form.open sample.submit-button[0]', at('submitting', 'idle'), []],
      [
        'viewing.form.submitting onDone[0]',
        at('closed', 'idle'),
        [show(['left']), show(['created']), show(['entered'])],
      ],
      [
        'viewing.form.submitting onError[0]',
        at('open', 'idle'),
        [show(['refused']), show(['opened'])],
      ],
      ['viewing.notes.idle sample.add-button[0]', at('closed', 'adding'), []],
      [
        'viewing.notes.idle sample.leave-button[0]',
        'away',
        [show(['unfolded']), show(['left']), show(['leaving'])],
      ],
      ['viewing.notes.idle sample.peek-button[0]', at('closed', 'idle'), []],
      ['viewing.notes.adding onDone[0]', at('closed', 'idle'), []],
      ['viewing.notes.adding onError[0]', at('closed', 'idle'), [show(['failed'])]],
      ['selecting onDone[0]', at('closed', 'idle'), [show(['entered'])]],
      ['creating onDone[0]', at('closed', 'idle'), [show(['entered'])]],
      [
        'creating onError[0]',
        at('open', 'idle'),
        [show(['refused']), show(['entered']), show(['opened'])],
      ],
    ])

    expect(cases.filter(({ actual }) => !actual.handled).map(({ label }) => label)).toEqual([
      'viewing.notes.idle sample.peek-button[0]',
    ])

    for (const { label, expected, actual } of cases) {
      expect(actual, label).toEqual(expected)
    }

    expect(cases.map(({ label }) => label)).toEqual(casesOfFlow(AREAS).map(({ label }) => label))
  })
  it('walks a state of a region that only a deep target of the root enters', () => {
    const flow = flowOf({
      initial: 'loading',
      states: {
        loading: { on: { 'sample.go-button': { target: 'viewing.form.open' } } },
        viewing: {
          type: 'parallel',
          states: {
            form: {
              initial: 'closed',
              states: {
                closed: { on: { 'sample.toggle-button': {} } },
                open: { on: { 'sample.toggle-button': { target: 'closed' } } },
              },
            },
            notes: {
              initial: 'idle',
              states: { idle: { on: { 'sample.add-button': {} } } },
            },
          },
        },
      },
    })
    const { visited, cases } = walk(flow)

    expect(visited).toEqual([
      'loading',
      'viewing',
      'viewing.form',
      'viewing.form.closed',
      'viewing.form.open',
      'viewing.notes',
      'viewing.notes.idle',
    ])

    for (const { label, expected, actual } of cases) {
      expect(actual, label).toEqual(expected)
    }

    expect(cases.map(({ label }) => label)).toEqual(casesOfFlow(flow).map(({ label }) => label))
  })
})
