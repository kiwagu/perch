import { describe, expect, it } from 'vitest'

import { authoredFlowSchema, controlRegionSchema, flowSchema } from '.'

const SHOW_ERROR = {
  type: 'show',
  params: { anchor: 'user.sign-in.error', codes: ['invalid-credentials', 'failed'] },
}

/** A machine config of the subset: every field it accepts, each once. */
const SIGN_IN = {
  id: 'sign-in',
  description: 'Signs in, or creates an account.',
  initial: 'sign-in',
  meta: { guards: { nameGiven: 'the name input holds a name' } },
  states: {
    'sign-in': {
      description: 'The form in the mode sign-in.',
      meta: { address: { path: '/sign-in', search: { mode: 'sign-in', page: 1, open: true } } },
      entry: [{ type: 'show', params: { anchor: 'user.sign-in.notice-message', codes: ['x'] } }],
      exit: [
        { type: 'clear', params: { anchor: 'user.sign-in.notice-message' } },
        { type: 'navigate', params: { to: '/sign-in', search: { mode: '$id' } } },
      ],
      on: {
        'user.sign-in.toggle-button': { target: 'sign-up', description: 'The name input appears.' },
        'user.sign-in.submit-button': { target: 'signing-in' },
        'platform.opened': [{ guard: 'nameGiven', target: 'sign-up' }, { target: 'sign-in' }],
      },
    },
    'sign-up': { on: { 'user.sign-in.toggle-button': {} } },
    'signing-in': {
      invoke: {
        src: 'platform.sign-in',
        input: { email: 'user.sign-in.email-input', remember: { value: false } },
        onDone: { target: 'done', actions: [{ type: 'navigate', params: { to: '/me' } }] },
        onError: [{ target: 'sign-in', actions: [SHOW_ERROR] }],
      },
    },
    done: { type: 'final' },
  },
}

/** The sign-in config with `change` applied to a copy of it. */
function changed(change: (config: Record<string, unknown>) => void): boolean {
  const config: Record<string, unknown> = structuredClone(SIGN_IN)

  change(config)

  return flowSchema.safeParse(config).success
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The state `name` of a config, for a case to change. */
function stateOf(config: Record<string, unknown>, name: string): Record<string, unknown> {
  const states = config['states']
  const state = isRecord(states) ? states[name] : undefined

  if (!isRecord(state)) {
    throw new Error(`no state ${name}`)
  }

  return state
}

describe('flowSchema', () => {
  it('accepts a machine config of the subset', () => {
    expect(flowSchema.safeParse(SIGN_IN).success).toBe(true)
  })
  it('accepts a model action as the source of an invoke', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'signing-in')['invoke'] ?? {}, { src: 'note.createNote' })
      }),
    ).toBe(true)
  })
  it('refuses an action named by a string, as XState allows and the subset does not', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-in'), { entry: ['show'] })
      }),
    ).toBe(false)
  })
  it('refuses an effect other than show, clear and navigate', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-in'), { entry: [{ type: 'assign', params: {} }] })
      }),
    ).toBe(false)
  })
  it('refuses a clear naming codes', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-in'), {
          exit: [{ type: 'clear', params: { anchor: 'user.sign-in.error', codes: ['failed'] } }],
        })
      }),
    ).toBe(false)
  })
  it('refuses a show without codes and a navigate to what is not a path', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-in'), {
          entry: [{ type: 'show', params: { anchor: 'user.sign-in.error', codes: [] } }],
        })
      }),
    ).toBe(false)
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-in'), {
          exit: [{ type: 'navigate', params: { to: 'me' } }],
        })
      }),
    ).toBe(false)
  })
  it('refuses an id of two segments, as XState splits an id target on `.`', () => {
    expect(
      changed((config) => {
        config['id'] = 'user.sign-in'
      }),
    ).toBe(false)
  })
  it('refuses a context, as the subset keeps no data', () => {
    expect(
      changed((config) => {
        config['context'] = { error: null }
      }),
    ).toBe(false)
  })
  it('refuses nested states in a plain state, and a parallel state without regions', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), { initial: 'a', states: { a: {} } })
      }),
    ).toBe(false)
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), { type: 'parallel' })
      }),
    ).toBe(false)
  })
  it('refuses a delayed and an eventless transition', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), { after: { 1000: { target: 'sign-in' } } })
      }),
    ).toBe(false)
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), { always: { target: 'sign-in' } })
      }),
    ).toBe(false)
  })
  it('refuses a target by id or by child, and an event that is no anchor', () => {
    for (const target of ['#user.sign-in.done', '.child', 'Done']) {
      expect(
        changed((config) => {
          Object.assign(stateOf(config, 'sign-up'), { on: { 'user.sign-in.form': { target } } })
        }),
      ).toBe(false)
    }

    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), { on: { SUBMIT: { target: 'sign-in' } } })
      }),
    ).toBe(false)
  })
  it('refuses a guard that is not a name, and an empty list of transitions', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), {
          on: { 'user.sign-in.form': { guard: 'the name is given' } },
        })
      }),
    ).toBe(false)
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-up'), { on: { 'user.sign-in.form': [] } })
      }),
    ).toBe(false)
  })
  it('refuses an input parameter that is neither an anchor nor a constant', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'signing-in')['invoke'] ?? {}, {
          input: { email: 'Not An Anchor' },
        })
      }),
    ).toBe(false)
  })
  it('refuses an invoke without onDone, and one whose source names no action', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'signing-in'), { invoke: { src: 'platform.sign-in' } })
      }),
    ).toBe(false)
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'signing-in')['invoke'] ?? {}, { src: 'signIn' })
      }),
    ).toBe(false)
  })
})

/** A flow whose `viewing` is a parallel state of two regions: every field it accepts, each once. */
const AREAS = {
  initial: 'viewing',
  states: {
    viewing: {
      type: 'parallel',
      description: 'Two areas at once.',
      meta: { address: { path: '/org' } },
      entry: [SHOW_ERROR],
      exit: [SHOW_ERROR],
      on: { 'organisation.page.current-select': { target: 'selecting' } },
      states: {
        form: {
          description: 'The create form.',
          initial: 'closed',
          states: {
            closed: { on: { 'organisation.create.toggle-button': { target: 'open' } } },
            open: {
              description: 'The form is open.',
              entry: [SHOW_ERROR],
              exit: [SHOW_ERROR],
              on: { 'organisation.create.toggle-button': { target: 'closed' } },
            },
          },
        },
        notes: {
          initial: 'idle',
          states: {
            idle: { on: { 'organisation.notes.add-button': { target: 'adding' } } },
            adding: { invoke: { src: 'note.createNote', onDone: { target: 'idle' } } },
          },
        },
      },
    },
    selecting: {
      invoke: {
        src: 'platform.organisations.select',
        onDone: { target: 'viewing' },
        onError: { target: 'viewing.form.open' },
      },
    },
  },
}

/** The areas config with `change` applied to a copy of `viewing` in it. */
function viewingChanged(change: (viewing: Record<string, unknown>) => void): boolean {
  const config: Record<string, unknown> = structuredClone(AREAS)

  change(stateOf(config, 'viewing'))

  return flowSchema.safeParse(config).success
}

/** The region `name` of a parallel state, for a case to change. */
const regionOf = (viewing: Record<string, unknown>, name: string): Record<string, unknown> =>
  stateOf(viewing, name)

describe('flowSchema with a parallel state', () => {
  it('accepts a parallel state of regions, and a deep target into one of them', () => {
    expect(flowSchema.safeParse(AREAS).success).toBe(true)
  })
  it('refuses an invoke, an initial state or an onDone on a parallel state', () => {
    for (const more of [
      { invoke: { src: 'note.createNote', onDone: { target: 'selecting' } } },
      { initial: 'form' },
      { onDone: { target: 'selecting' } },
    ]) {
      expect(
        viewingChanged((viewing) => {
          Object.assign(viewing, more)
        }),
        Object.keys(more).join(),
      ).toBe(false)
    }
  })
  it('wants two regions or more', () => {
    expect(
      viewingChanged((viewing) => {
        viewing['states'] = { form: regionOf(viewing, 'form') }
      }),
    ).toBe(false)
  })
  it('refuses a region with an event, and a region without its initial state', () => {
    expect(
      viewingChanged((viewing) => {
        Object.assign(regionOf(viewing, 'form'), { on: {} })
      }),
    ).toBe(false)
    expect(
      viewingChanged((viewing) => {
        delete regionOf(viewing, 'form')['initial']
      }),
    ).toBe(false)
  })
  it('refuses a final state, an address, nested states and a parallel state in a region', () => {
    for (const more of [
      { type: 'final' },
      { meta: { address: { path: '/org' } } },
      { initial: 'a', states: { a: {} } },
      { type: 'parallel', states: {} },
    ]) {
      expect(
        viewingChanged((viewing) => {
          Object.assign(stateOf(regionOf(viewing, 'form'), 'closed'), more)
        }),
        JSON.stringify(more),
      ).toBe(false)
    }
  })
  it('refuses a deep target of two names or of four', () => {
    for (const target of ['viewing.form', 'viewing.form.open.inner', 'viewing..open']) {
      const selecting = { on: { 'user.sign-in.form': { target } } }

      expect(
        flowSchema.safeParse({ ...AREAS, states: { ...AREAS.states, selecting } }).success,
        target,
      ).toBe(false)
    }
  })
  it('accepts an id target `#<flow id>.<state>`, the id one segment, as XState splits on `.`', () => {
    const at = (target: string) =>
      viewingChanged((viewing) => {
        const closed = stateOf(regionOf(viewing, 'form'), 'closed')

        closed['on'] = { 'organisation.create.submit-button': { target } }
      })

    expect(at('#organisation.selecting')).toBe(true)

    for (const target of [
      '#organisation',
      '#user.sign-in.selecting',
      '#organisation.viewing.form',
    ]) {
      expect(at(target), target).toBe(false)
    }
  })
})

describe('the toast opt-out', () => {
  const flowWith = (invoke: Record<string, unknown>) => ({
    initial: 'saving',
    states: { saving: { invoke: { src: 'thing.createThing', onDone: 'saving', ...invoke } } },
  })

  it('lets an authored invoke and a region by its button say no toast', () => {
    expect(authoredFlowSchema.safeParse(flowWith({ toast: false })).success).toBe(true)
    expect(
      controlRegionSchema.safeParse({ by: 'sample.form.add-button', toast: false }).success,
    ).toBe(true)
  })

  it('takes only false, and the canonical flow knows no toast at all', () => {
    expect(authoredFlowSchema.safeParse(flowWith({ toast: true })).success).toBe(false)
    expect(
      controlRegionSchema.safeParse({ by: 'sample.form.add-button', toast: true }).success,
    ).toBe(false)
    expect(
      flowSchema.safeParse({
        initial: 'saving',
        states: {
          saving: {
            invoke: { src: 'thing.createThing', onDone: { target: 'saving' }, toast: false },
          },
        },
      }).success,
    ).toBe(false)
  })
})
