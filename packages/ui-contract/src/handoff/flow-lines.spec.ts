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
  it('writes a read as an effect, and read: false on the line of its invoke', () => {
    const flow = flowIn(sampleContract())
    const saving = flow.states['saving']

    if (saving === undefined || saving.type === 'parallel' || saving.invoke === undefined) {
      throw new Error('the sample flow lost its saving state')
    }

    saving.invoke.onDone = {
      target: 'editing',
      actions: [{ type: 'read', params: { anchor: 'sample.devices-list' } }],
    }

    expect(flowLines(flow)).toContain('saving onDone -> editing read sample.devices-list')
    expect(flowLines(flow)).toContain(
      'saving invoke thing.updateThing {"title":"sample.title-input"}',
    )

    saving.invoke.read = false

    expect(flowLines(flow)).toContain(
      'saving invoke thing.updateThing {"title":"sample.title-input"} read: false',
    )
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
  it("writes a state's address first, its path and its search as JSON with its keys sorted", () => {
    const flow = flowIn(sampleContract())
    const editing = flow.states['editing']
    const viewing = PARALLEL.states['viewing']

    if (editing === undefined || viewing === undefined) {
      throw new Error('the sample flow lost a state')
    }

    editing.meta = { address: { path: '/sample/$key', search: { tab: 'a', id: '$id' } } }

    expect(flowLines(flow).slice(0, 2)).toEqual([
      'initial editing',
      'editing address /sample/$key {"id":"$id","tab":"a"}',
    ])

    editing.meta = { address: { path: '/sample/$key' } }

    expect(flowLines(flow)).toContain('editing address /sample/$key')
    expect(
      flowLines({
        ...PARALLEL,
        states: {
          ...PARALLEL.states,
          viewing: { ...viewing, meta: { address: { search: { tab: 'b' } } } },
        },
      }),
    ).toContain('viewing address {"tab":"b"}')
  })
  it('writes each anchor a state renders after its address, a state of any kind by its path', () => {
    const viewing = PARALLEL.states['viewing']

    if (viewing?.type !== 'parallel') {
      throw new Error('the parallel flow lost its viewing state')
    }

    const form = viewing.states['form'] ?? expect.unreachable('a form region')
    const open = form.states['open'] ?? expect.unreachable('an open state')
    const lines = flowLines({
      ...PARALLEL,
      states: {
        viewing: {
          ...viewing,
          meta: { address: { path: '/sample' }, renders: ['sample.done-button'] },
          states: {
            ...viewing.states,
            form: {
              ...form,
              states: {
                ...form.states,
                open: { ...open, meta: { renders: ['sample.close-button', 'sample.form.error'] } },
              },
            },
          },
        },
        done: { type: 'final', meta: { renders: ['sample.home-link'] } },
      },
    })

    expect(lines.slice(1, 3)).toEqual([
      'viewing address /sample',
      'viewing renders sample.done-button',
    ])
    expect(lines).toContain('viewing.form.open renders sample.close-button')
    expect(lines).toContain('viewing.form.open renders sample.form.error')
    expect(lines).toContain('done renders sample.home-link')
  })
  it('writes the codes each guard by failure code takes, as written, after the initial state', () => {
    const flow = flowIn(sampleContract())

    flow.meta = {
      guards: {
        titleGiven: 'the title input holds a title',
        unusable: { codes: ['link-invalid', 'link-expired'] },
        limited: { codes: ['rate-limited'] },
      },
    }

    const lines = flowLines(flow)

    expect(lines.slice(0, 3)).toEqual([
      'initial editing',
      'guard unusable takes link-invalid, link-expired',
      'guard limited takes rate-limited',
    ])
    expect(lines.filter((line) => line.startsWith('guard '))).toHaveLength(2)
  })
  it("writes a navigate that takes an entry's data-id with the item it names", () => {
    const flow: Flow = {
      initial: 'viewing',
      states: {
        viewing: {
          on: {
            'sample.list.open-link': {
              target: 'opened',
              actions: [
                {
                  type: 'navigate',
                  params: { to: '/thing', search: { id: { item: 'sample.list.thing-item' } } },
                },
              ],
            },
          },
        },
        opened: { type: 'final' },
      },
    }

    expect(flowLines(flow)).toEqual([
      'initial viewing',
      'viewing on sample.list.open-link -> opened navigate /thing {"id":{"item":"sample.list.thing-item"}}',
      'opened final',
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
