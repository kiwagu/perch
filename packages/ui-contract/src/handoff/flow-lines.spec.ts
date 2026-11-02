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
      'editing on sample.save-button #1 -> saving [titleGiven]',
      'editing on sample.save-button #2 show sample.save-button: failed',
      'saving invoke thing.updateThing {"title":"sample.title-input"}',
      'saving onDone -> editing show sample.save-button: saved navigate /sample/$key {"tab":"a"}',
      'saving onError -> editing show sample.save-button: failed',
    ])
  })
  it('numbers the guarded alternatives of an outcome and the entry effects, by their order', () => {
    const flow = flowIn(sampleContract())
    const saving = flow.states['saving']

    if (saving === undefined || saving.type === 'parallel' || saving.invoke === undefined) {
      throw new Error('the sample flow lost its saving state')
    }

    saving.invoke.onError = [{ guard: 'titleGiven', target: 'saving' }, { target: 'editing' }]
    saving.entry = [
      { type: 'clear', params: { anchor: 'sample.save-button' } },
      { type: 'clear', params: { anchor: 'sample.title-input' } },
    ]

    expect(flowLines(flow)).toEqual([
      'initial editing',
      'editing on sample.save-button #1 -> saving [titleGiven]',
      'editing on sample.save-button #2 show sample.save-button: failed',
      'saving entry #1 clear sample.save-button',
      'saving entry #2 clear sample.title-input',
      'saving invoke thing.updateThing {"title":"sample.title-input"}',
      'saving onDone -> editing show sample.save-button: saved navigate /sample/$key {"tab":"a"}',
      'saving onError #1 -> saving [titleGiven]',
      'saving onError #2 -> editing',
    ])
  })
  it('writes an invoke input as JSON with its keys sorted, and nothing after an invoke without one', () => {
    const flow = flowIn(sampleContract())
    const saving = flow.states['saving']

    if (saving === undefined || saving.type === 'parallel' || saving.invoke === undefined) {
      throw new Error('the sample flow lost its saving state')
    }

    saving.invoke.input = { title: { value: 'x' }, id: 'sample.thing-item' }

    expect(flowLines(flow)).toContain(
      'saving invoke thing.updateThing {"id":"sample.thing-item","title":{"value":"x"}}',
    )

    delete saving.invoke.input

    expect(flowLines(flow)).toContain('saving invoke thing.updateThing')
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
