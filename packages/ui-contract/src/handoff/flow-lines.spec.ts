import { describe, expect, it } from 'vitest'

import { flowIn, sampleContract } from '../check/contract.fixture'
import type { Flow } from '../files'

import { flowLines } from './flow-lines'

/** A flow with a parallel state of two regions, an entry on a region's state and a final state. */
const PARALLEL: Flow = {
  initial: 'viewing',
  description: 'A form beside a list, until done.',
  states: {
    viewing: {
      type: 'parallel',
      description: 'The form and the list, each on its own.',
      on: { 'sample.done-button': { target: 'done', description: 'The user is done.' } },
      states: {
        form: {
          initial: 'idle',
          states: {
            idle: { on: { 'sample.open-button': { target: 'open' } } },
            open: {
              description: 'The form is open, its error cleared.',
              entry: [{ type: 'clear', params: { anchor: 'sample.form.error' } }],
              on: { 'sample.close-button': { target: 'idle' } },
            },
          },
        },
        list: { initial: 'shown', states: { shown: {} } },
      },
    },
    done: { type: 'final', description: 'The flow ends.' },
  },
}

describe('flowLines', () => {
  it('writes one line per entry, exit, transition, invoke and outcome, with targets, guards and effects', () => {
    expect(flowLines(flowIn(sampleContract()))).toEqual([
      'initial editing',
      'editing on sample.save-button -> saving [titleGiven]',
      'editing on sample.save-button show sample.save-button: failed',
      'saving invoke thing.updateThing',
      'saving onDone -> editing show sample.save-button: saved navigate /sample/$key {"tab":"a"}',
      'saving onError -> editing show sample.save-button: failed',
    ])
  })
  it('walks a parallel state into its regions, naming states by their path', () => {
    expect(flowLines(PARALLEL)).toEqual([
      'initial viewing',
      'viewing on sample.done-button -> done',
      'viewing.form initial idle',
      'viewing.form.idle on sample.open-button -> open',
      'viewing.form.open entry clear sample.form.error',
      'viewing.form.open on sample.close-button -> idle',
      'viewing.list initial shown',
      'done final',
    ])
  })
  it('writes an exit, and a transition without a target, guard or effect as its event alone', () => {
    const flow = flowIn(sampleContract())

    flow.states['idle'] = {
      exit: [{ type: 'clear', params: { anchor: 'sample.title-input' } }],
      on: { 'sample.a-button': {} },
    }

    expect(flowLines(flow).slice(-2)).toEqual([
      'idle exit clear sample.title-input',
      'idle on sample.a-button',
    ])
  })
})
