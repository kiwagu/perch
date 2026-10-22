import { describe, expect, it } from 'vitest'

import { flowSchema } from './flow'

const SHOW_ERROR = {
  type: 'show',
  params: { anchor: 'user.sign-in.error', codes: ['invalid-credentials', 'failed'] },
}

/** A machine config of the subset: every field it accepts, each once. */
const SIGN_IN = {
  id: 'user.sign-in',
  description: 'Signs in, or creates an account.',
  initial: 'sign-in',
  meta: { guards: { nameGiven: 'the name input holds a name' } },
  states: {
    'sign-in': {
      description: 'The form in the mode sign-in.',
      meta: { address: { path: '/sign-in', search: { mode: 'sign-in', page: 1, open: true } } },
      entry: [{ type: 'show', params: { anchor: 'user.sign-in.notice-message', codes: ['x'] } }],
      exit: [{ type: 'navigate', params: { to: '/sign-in', search: { mode: '$id' } } }],
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
  it('refuses an effect other than show and navigate', () => {
    expect(
      changed((config) => {
        Object.assign(stateOf(config, 'sign-in'), { entry: [{ type: 'assign', params: {} }] })
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
  it('refuses a context, as the subset keeps no data', () => {
    expect(
      changed((config) => {
        config['context'] = { error: null }
      }),
    ).toBe(false)
  })
  it('refuses nested states and a parallel state', () => {
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
