import { describe, expect, it } from 'vitest'

import type { Flow } from '../../files'

import { deepTargetOf, flowNodes, regionStartsOf, transitionsOf } from './nodes'

/** A flow with a plain state, then a parallel state of two regions. */
const AREAS: Flow = {
  initial: 'viewing',
  states: {
    selecting: {
      invoke: {
        src: 'platform.organisations.select',
        onDone: { target: 'viewing' },
        onError: { target: 'viewing.notes.adding' },
      },
    },
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
  },
}

describe('flowNodes', () => {
  it('lists every state in the order of the file: root states, regions, their states', () => {
    expect(
      flowNodes(AREAS).map(({ kind, name, path, at }) => [kind, name, path, at.join('.')]),
    ).toEqual([
      ['root', 'selecting', 'selecting', 'states.selecting'],
      ['parallel', 'viewing', 'viewing', 'states.viewing'],
      ['region', 'form', 'viewing.form', 'states.viewing.states.form'],
      ['region-state', 'closed', 'viewing.form.closed', 'states.viewing.states.form.states.closed'],
      ['region-state', 'open', 'viewing.form.open', 'states.viewing.states.form.states.open'],
      ['region', 'notes', 'viewing.notes', 'states.viewing.states.notes'],
      ['region-state', 'idle', 'viewing.notes.idle', 'states.viewing.states.notes.states.idle'],
      [
        'region-state',
        'adding',
        'viewing.notes.adding',
        'states.viewing.states.notes.states.adding',
      ],
    ])
  })
  it('names the parallel state and the region of a region state', () => {
    const adding = flowNodes(AREAS).find(({ path }) => path === 'viewing.notes.adding')

    expect(adding).toMatchObject({ kind: 'region-state', parallel: 'viewing', region: 'notes' })
    expect(adding?.kind === 'region-state' && Object.keys(adding.siblings)).toEqual([
      'idle',
      'adding',
    ])
  })
})

describe('the targets of a flow', () => {
  it('reads a deep target as its parallel state, region and state', () => {
    expect(deepTargetOf('viewing.notes.adding')).toEqual({
      parallel: 'viewing',
      region: 'notes',
      state: 'adding',
    })
    expect(deepTargetOf('viewing')).toBeUndefined()
  })
  it('starts each region at its initial state, the one a deep target names at that state', () => {
    const viewing = AREAS.states['viewing']

    if (viewing?.type !== 'parallel') {
      throw new Error('viewing is a parallel state')
    }

    expect(regionStartsOf(viewing, 'viewing')).toEqual([
      ['form', 'closed'],
      ['notes', 'idle'],
    ])
    expect(regionStartsOf(viewing, 'viewing.notes.adding')).toEqual([
      ['form', 'closed'],
      ['notes', 'adding'],
    ])
  })
  it("takes a state's transitions on its events and when its invoke ends", () => {
    expect(
      flowNodes(AREAS).map((node) =>
        node.kind === 'region' ? [] : transitionsOf(node.state).map(({ target }) => target),
      ),
    ).toEqual([
      ['viewing', 'viewing.notes.adding'],
      ['selecting'],
      [],
      ['open'],
      ['closed'],
      [],
      ['adding'],
      ['idle'],
    ])
  })
})
