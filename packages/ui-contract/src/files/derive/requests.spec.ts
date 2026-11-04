import { describe, expect, it } from 'vitest'

import { isBare, requestsOf } from './requests'

const ANCHORS = new Set([
  'user.sign-in.error',
  'user.settings.password.error',
  'user.settings.email.error',
  'user.settings.error',
])
const declared = (anchor: string) => ANCHORS.has(anchor)

const requestOf = (flow: unknown, screen: string, name: string) =>
  requestsOf(flow, screen, declared).find((request) => request.name === name)

/** The way back and the error of the request `name`. */
const outcomeOf = (flow: unknown, screen: string, name: string) => {
  const request = requestOf(flow, screen, name)

  return { back: request?.back, error: request?.error }
}

describe('requestsOf', () => {
  it('finds the way back and the error of a state one sibling enters on a control', () => {
    const flow = {
      initial: 'idle',
      states: {
        idle: { on: { 'user.sign-in.submit-button': 'signing-in' } },
        'signing-in': { invoke: { src: 'platform.sign-in', onDone: 'done' } },
        done: { type: 'final' },
      },
    }

    expect(requestsOf(flow, 'user.sign-in', declared)).toEqual([
      {
        name: 'signing-in',
        names: ['signing-in'],
        at: ['states', 'signing-in'],
        state: flow.states['signing-in'],
        src: 'platform.sign-in',
        onError: undefined,
        back: { state: 'idle' },
        error: { anchor: 'user.sign-in.error' },
      },
    ])
  })

  it("takes the part of the control's error, else the screen's", () => {
    const region = (part: string) => ({
      initial: 'idle',
      states: {
        idle: { on: { [`${part}.save-button`]: { target: 'saving' } } },
        saving: { invoke: { src: 'platform.change-password', onDone: 'idle' } },
      },
    })
    const flow = {
      initial: 'viewing',
      states: {
        viewing: {
          type: 'parallel',
          states: {
            password: region('user.settings.password'),
            theme: region('user.settings.theme'),
          },
        },
      },
    }

    expect(outcomeOf(flow, 'user.settings', 'saving')).toEqual({
      back: { state: 'idle' },
      error: { anchor: 'user.settings.password.error' },
    })
    expect(requestsOf(flow, 'user.settings', declared)[1]?.error).toEqual({
      anchor: 'user.settings.error',
    })
    expect(requestsOf(flow, 'user.profile', declared)[1]).toMatchObject({
      back: { state: 'idle' },
      error: { why: 'no user.settings.theme.error and no user.profile.error' },
    })
  })

  it('has no way back from an initial state, two enterers, an outcome, or outside the area', () => {
    const initial = {
      initial: 'verifying',
      states: {
        verifying: { invoke: { src: 'platform.verify-email', onDone: 'done' } },
        done: { type: 'final' },
      },
    }
    const two = {
      initial: 'idle',
      states: {
        idle: { on: { 'user.sign-in.submit-button': 'sending' } },
        sent: { on: { 'user.sign-in.submit-button': 'sending' } },
        sending: { invoke: { src: 'platform.sign-in', onDone: 'sent' } },
      },
    }
    const chained = {
      initial: 'idle',
      states: {
        idle: { on: { 'user.sign-in.submit-button': 'first' } },
        first: { invoke: { src: 'platform.sign-in', onDone: 'second', onError: 'idle' } },
        second: { invoke: { src: 'platform.sign-up', onDone: 'idle' } },
      },
    }
    const deep = {
      initial: 'idle',
      states: {
        idle: { on: { 'user.sign-in.submit-button': 'viewing.form.sending' } },
        viewing: {
          type: 'parallel',
          states: {
            form: {
              initial: 'rest',
              states: {
                rest: {},
                sending: { invoke: { src: 'platform.sign-in', onDone: 'rest' } },
              },
            },
            other: { initial: 'rest', states: { rest: {} } },
          },
        },
      },
    }
    const nothing = {
      initial: 'idle',
      states: {
        idle: {},
        orphan: { invoke: { src: 'platform.sign-in', onDone: 'idle' } },
      },
    }

    expect(outcomeOf(initial, 'user.sign-in', 'verifying')).toEqual({
      back: { why: 'verifying is where its area starts, so it has no single way back' },
      error: { anchor: 'user.sign-in.error' },
    })
    expect(requestOf(nothing, 'user.sign-in', 'orphan')?.back).toEqual({
      why: 'nothing enters orphan, so it has no way back',
    })
    expect(outcomeOf(two, 'user.sign-in', 'sending')).toEqual({
      back: { why: 'sending is entered from idle and sent: no single way back' },
      error: { anchor: 'user.sign-in.error' },
    })
    expect(requestOf(chained, 'user.sign-in', 'second')?.back).toEqual({
      why: 'second is entered by the outcome of first, not by a control',
    })
    expect(outcomeOf(deep, 'user.sign-in', 'sending')).toEqual({
      back: { why: 'sending is entered from outside its area (idle)' },
      error: { anchor: 'user.sign-in.error' },
    })
  })

  it('has no way back from a state where its area starts, though a sibling retries into it', () => {
    const atRoot = {
      initial: 'loading',
      states: {
        loading: { invoke: { src: 'platform.sign-in', onDone: 'done' } },
        failed: { on: { 'user.sign-in.retry-button': 'loading' } },
        done: { type: 'final' },
      },
    }
    const inRegion = {
      initial: 'viewing',
      states: {
        viewing: {
          type: 'parallel',
          states: {
            password: {
              initial: 'saving',
              states: {
                saving: { invoke: { src: 'platform.change-password', onDone: 'idle' } },
                failed: { on: { 'user.settings.password.retry-button': 'saving' } },
                idle: {},
              },
            },
            other: { initial: 'rest', states: { rest: {} } },
          },
        },
      },
    }

    expect(outcomeOf(atRoot, 'user.sign-in', 'loading')).toEqual({
      back: { why: 'loading is where its area starts, so it has no single way back' },
      error: { anchor: 'user.sign-in.error' },
    })
    expect(outcomeOf(inRegion, 'user.settings', 'saving')).toEqual({
      back: { why: 'saving is where its area starts, so it has no single way back' },
      error: { anchor: 'user.settings.password.error' },
    })
  })

  it("falls back to the screen's error when no control enters and the input names no field", () => {
    const linked = {
      initial: 'verifying',
      states: {
        verifying: {
          invoke: {
            src: 'platform.verify-email',
            input: { token: { search: 'token' } },
            onDone: 'done',
            onError: 'failed',
          },
        },
        failed: {},
        done: { type: 'final' },
      },
    }

    expect(outcomeOf(linked, 'user.settings', 'verifying')).toEqual({
      back: { why: 'verifying is where its area starts, so it has no single way back' },
      error: { anchor: 'user.settings.error' },
    })
    expect(requestOf(linked, 'user.verify-email', 'verifying')?.error).toEqual({
      why: 'no control enters verifying and its input names no field: no part has its error, and no user.verify-email.error',
    })
  })

  it('has a way back only when every transition entering the state is on a control', () => {
    const entering = (events: Record<string, string>) => ({
      initial: 'idle',
      states: {
        idle: { on: events },
        loading: {
          invoke: {
            src: 'platform.sign-in',
            input: { email: 'user.sign-in.email-input' },
            onDone: 'idle',
          },
        },
      },
    })

    expect(
      outcomeOf(entering({ 'model.profile.name': 'loading' }), 'user.sign-in', 'loading'),
    ).toEqual({
      back: { why: 'loading is entered on model.profile.name, not by a control' },
      error: { anchor: 'user.sign-in.error' },
    })
    expect(
      requestOf(
        entering({ 'user.sign-in.submit-button': 'loading', 'platform.opened': 'loading' }),
        'user.sign-in',
        'loading',
      )?.back,
    ).toEqual({ why: 'loading is entered on platform.opened, not by a control' })
  })

  it("takes the input fields' part when no control enters, and refuses parts that differ", () => {
    const byEvent = {
      initial: 'idle',
      states: {
        idle: { on: { 'platform.opened': 'loading' } },
        loading: {
          invoke: {
            src: 'platform.sign-in',
            input: { email: 'user.sign-in.email-input' },
            onDone: 'idle',
          },
        },
      },
    }
    const parts = {
      initial: 'idle',
      states: {
        idle: {
          on: {
            'user.settings.password.save-button': 'saving',
            'user.settings.email.send-button': 'saving',
          },
        },
        saving: { invoke: { src: 'platform.sign-in', onDone: 'idle' } },
      },
    }
    const fields = {
      initial: 'saving',
      states: {
        saving: {
          invoke: {
            src: 'platform.change-password',
            input: {
              password: 'user.settings.password.new-password-input',
              email: 'user.settings.email.email-input',
              token: { search: 'token' },
            },
            onDone: 'saving',
          },
        },
      },
    }

    expect(outcomeOf(byEvent, 'user.sign-in', 'loading')).toEqual({
      back: { why: 'loading is entered on platform.opened, not by a control' },
      error: { anchor: 'user.sign-in.error' },
    })
    expect(outcomeOf(parts, 'user.settings', 'saving')).toEqual({
      back: { state: 'idle' },
      error: {
        why: 'the controls that enter saving sit in different parts (user.settings.password, user.settings.email)',
      },
    })
    expect(requestOf(fields, 'user.settings', 'saving')?.error).toEqual({
      why: 'the fields the input of saving names sit in different parts (user.settings.password, user.settings.email)',
    })
  })

  it('reads a written onError, and a transition written as its target', () => {
    const flow = {
      initial: 'idle',
      states: {
        idle: { on: { 'user.sign-in.submit-button': { target: 'signing-in' } } },
        'signing-in': { invoke: { src: 'platform.sign-in', onDone: 'idle', onError: 'idle' } },
      },
    }

    expect(requestsOf(flow, 'user.sign-in', declared)[0]?.onError).toBe('idle')
    expect(requestsOf('no', 'user.sign-in', declared)).toEqual([])
  })
})

describe('isBare', () => {
  it('is an onError written as its target alone: a string, or a record without actions', () => {
    expect(isBare('idle')).toBe(true)
    expect(isBare({ target: 'idle', description: 'Back.' })).toBe(true)
    expect(isBare({ target: 'idle', actions: [{ clear: 'x.error' }] })).toBe(false)
    expect(isBare([{ target: 'idle', guard: 'g' }, 'idle'])).toBe(false)
    expect(isBare(undefined)).toBe(false)
  })
})
