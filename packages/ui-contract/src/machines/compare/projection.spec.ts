import { describe, expect, it } from 'vitest'
import { createMachine } from 'xstate'

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
