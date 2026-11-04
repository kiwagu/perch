import { describe, expect, it } from 'vitest'
import { createMachine } from 'xstate'

import { renderedAt } from '../../anchors'
import { flowSchema } from '../../schemas'

import { beyondTheSubset } from './beyond'
import { projected } from './projection'

describe('the projection of a machine config', () => {
  it('compares a parallel state by its regions, their initial states and their states', () => {
    const config = {
      initial: 'viewing',
      states: {
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
        selecting: {
          invoke: { src: 'platform.organisations.select', onDone: { target: 'viewing.form.open' } },
        },
      },
    } as const
    const flow = flowSchema.parse(config)
    const machine = createMachine(config)
    const opened = createMachine({
      ...config,
      states: {
        ...config.states,
        viewing: {
          ...config.states.viewing,
          states: {
            ...config.states.viewing.states,
            form: { ...config.states.viewing.states.form, initial: 'open' },
          },
        },
      },
    })

    expect(beyondTheSubset(machine.config)).toEqual([])
    expect(projected(machine.config)).toEqual(projected(flow))
    expect(projected(opened.config)).not.toEqual(projected(flow))
  })
})

describe('the projection of what a state renders', () => {
  /** A form whose `editing` state renders `anchors`, in a region of `viewing` and at the root. */
  const config = (anchors: readonly string[]) =>
    ({
      initial: 'editing',
      states: {
        editing: {
          meta: { renders: anchors },
          on: { 'sample.save-button': { target: 'viewing' } },
        },
        viewing: {
          type: 'parallel',
          states: {
            notes: {
              initial: 'idle',
              states: { idle: {}, open: { meta: { renders: anchors } } },
            },
            form: { initial: 'closed', states: { closed: {} } },
          },
        },
      },
    }) as const
  const flow = flowSchema.parse(config(['sample.name-input', 'sample.rule-list']))

  it('holds the anchors each state lists, of the root and of a region, in any order', () => {
    expect(
      projected(createMachine(config(['sample.rule-list', 'sample.name-input'])).config),
    ).toEqual(projected(flow))
  })

  it('tells a state that lists another anchor, or one fewer, from its flow', () => {
    for (const anchors of [['sample.name-input'], ['sample.name-input', 'sample.email-input']]) {
      expect(projected(createMachine(config(anchors)).config)).not.toEqual(projected(flow))
    }
  })

  it('reads a list as the app does: an anchor twice is once, and a bare string lists nothing', () => {
    const once = flowSchema.parse(config(['sample.name-input']))
    const bare = {
      initial: 'editing',
      states: { editing: { meta: { renders: 'sample.name-input' } } },
    }

    expect(
      projected(createMachine(config(['sample.name-input', 'sample.name-input'])).config),
    ).toEqual(projected(once))
    expect(projected(bare)).not.toEqual(
      projected({ ...bare, states: { editing: { meta: { renders: ['sample.name-input'] } } } }),
    )
    expect(renderedAt(bare, 'editing').listed).toEqual([])
  })
})

describe('the projection of a navigate', () => {
  it('holds the field a search value takes, as it holds a literal', () => {
    const config = (anchor: string) =>
      ({
        initial: 'form',
        states: {
          form: {
            on: {
              'sample.forgot-link': {
                target: 'gone',
                actions: [
                  {
                    type: 'navigate',
                    params: { to: '/forgot', search: { email: { anchor } } },
                  },
                ],
              },
            },
          },
          gone: { type: 'final' },
        },
      }) as const
    const flow = flowSchema.parse(config('sample.email-input'))

    expect(projected(createMachine(config('sample.email-input')).config)).toEqual(projected(flow))
    expect(projected(createMachine(config('sample.name-input')).config)).not.toEqual(
      projected(flow),
    )
  })
})

describe('the projection of a clear', () => {
  it('holds the field a clear empties, as it holds an anchor whose code it clears', () => {
    const config = (anchor: string) =>
      ({
        initial: 'form',
        states: {
          form: { on: { 'sample.save-button': { target: 'saving' } } },
          saving: {
            invoke: {
              src: 'platform.change-password',
              onDone: {
                target: 'form',
                actions: [
                  { type: 'clear', params: { anchor: 'sample.error' } },
                  { type: 'clear', params: { anchor } },
                ],
              },
            },
          },
        },
      }) as const
    const flow = flowSchema.parse(config('sample.password-input'))

    expect(projected(createMachine(config('sample.password-input')).config)).toEqual(
      projected(flow),
    )
    expect(projected(createMachine(config('sample.email-input')).config)).not.toEqual(
      projected(flow),
    )
  })
})
