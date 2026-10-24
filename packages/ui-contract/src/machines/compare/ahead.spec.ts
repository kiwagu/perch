import { describe, expect, it } from 'vitest'

import { aheadOf } from './ahead'
import { projected } from './projection'

const show = (codes: string[]) =>
  ({ type: 'show', params: { anchor: 'sample.notice-message', codes } }) as const

const clear = { type: 'clear', params: { anchor: 'sample.notice-message' } } as const

/** A flow a business commit has just changed: each part marked `added` is new in it. */
const FLOW = {
  initial: 'editing',
  states: {
    editing: {
      entry: [show(['opened']), show(['added'])],
      on: {
        'sample.save-button': [
          { guard: 'added', target: 'done' },
          { target: 'saving', actions: [clear, show(['saving'])] },
        ],
        'platform.signed-out': { actions: [clear] },
      },
    },
    saving: {
      invoke: {
        src: 'sample.save',
        onDone: { target: 'editing', actions: [show(['saved'])] },
        onError: { target: 'editing' },
      },
    },
    done: { type: 'final' },
    viewing: {
      type: 'parallel',
      states: {
        form: { initial: 'closed', states: { closed: {}, open: {} } },
        added: { initial: 'idle', states: { idle: {} } },
      },
    },
  },
}

/** The app's machine before its implementation commit: everything but what the flow added. */
const BEHIND = {
  initial: 'editing',
  states: {
    editing: {
      entry: [show(['opened'])],
      on: { 'sample.save-button': { target: 'saving', actions: [show(['saving'])] } },
    },
    saving: {
      invoke: {
        src: 'sample.save',
        onDone: { target: 'editing', actions: [show(['saved'])] },
        onError: { target: 'editing' },
      },
    },
    viewing: {
      type: 'parallel',
      states: { form: { initial: 'closed', states: { closed: {}, open: {} } } },
    },
  },
}

/** `BEHIND` with one more change of its own. */
function behindWith(change: (states: Record<string, Record<string, unknown>>) => void) {
  const config: { initial: string; states: Record<string, Record<string, unknown>> } =
    structuredClone(BEHIND)

  change(config.states)

  return config
}

describe('a machine that lags its flow', () => {
  it('may lack a state, an event, a guarded branch, an effect and a region the flow added', () => {
    const app = projected(BEHIND)

    expect(app).toEqual(aheadOf(app, projected(FLOW)))
  })

  it('may lack a state or a region named like a property every object has', () => {
    const flow = projected({
      ...FLOW,
      states: {
        ...FLOW.states,
        constructor: {},
        viewing: {
          type: 'parallel',
          states: {
            ...FLOW.states.viewing.states,
            toString: { initial: 'idle', states: { idle: {} } },
          },
        },
      },
    })
    const app = projected(BEHIND)

    expect(app).toEqual(aheadOf(app, flow))
  })

  it('is the whole flow when the machine lacks nothing', () => {
    const flow = projected(FLOW)

    expect(aheadOf(flow, flow)).toEqual(flow)
  })

  it('does nothing its flow does not say', () => {
    const flow = projected(FLOW)
    const changed = [
      behindWith((states) => {
        states['editing'] = { on: { 'sample.cancel-button': { target: 'editing' } } }
      }),
      behindWith((states) => {
        states['gone'] = {}
      }),
      behindWith((states) => {
        states['editing'] = { on: { 'sample.save-button': { target: 'editing' } } }
      }),
      behindWith((states) => {
        states['editing'] = { entry: [show(['opened']), show(['elsewhere'])] }
      }),
      behindWith((states) => {
        states['editing'] = { entry: [show(['added']), show(['opened'])] }
      }),
      behindWith((states) => {
        states['saving'] = { invoke: { src: 'sample.other', onDone: { target: 'editing' } } }
      }),
      behindWith((states) => {
        states['done'] = {}
      }),
      behindWith((states) => {
        states['editing'] = {
          on: { 'sample.save-button': { guard: 'other', target: 'saving' } },
        }
      }),
      behindWith((states) => {
        states['editing'] = {
          on: {
            'sample.save-button': [
              { target: 'saving', actions: [show(['saving'])] },
              { guard: 'added', target: 'done' },
            ],
          },
        }
      }),
      behindWith((states) => {
        states['viewing'] = {
          type: 'parallel',
          states: {
            form: { initial: 'closed', states: { closed: {}, open: {} } },
            extra: { initial: 'idle', states: { idle: {} } },
          },
        }
      }),
      behindWith((states) => {
        states['saving'] = {
          type: 'parallel',
          states: { form: { initial: 'closed', states: { closed: {} } } },
        }
      }),
      { ...BEHIND, initial: 'saving' },
    ]

    for (const config of changed) {
      const app = projected(config)

      expect(app).not.toEqual(aheadOf(app, flow))
    }
  })
})
