import { describe, expect, it } from 'vitest'

import { isBare, requestsOf } from './requests'

const ANCHORS = new Set([
  'user.sign-in.error',
  'user.settings.password.error',
  'user.settings.email.error',
  'user.settings.error',
])
const declared = (anchor: string) => ANCHORS.has(anchor)

const fallbackOf = (flow: unknown, screen: string, name: string) =>
  requestsOf(flow, screen, declared).find((request) => request.name === name)?.fallback

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
        fallback: { back: 'idle', error: 'user.sign-in.error' },
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

    expect(fallbackOf(flow, 'user.settings', 'saving')).toEqual({
      back: 'idle',
      error: 'user.settings.password.error',
    })
    expect(requestsOf(flow, 'user.settings', declared)[1]?.fallback).toEqual({
      back: 'idle',
      error: 'user.settings.error',
    })
    expect(requestsOf(flow, 'user.profile', declared)[1]?.fallback).toEqual({
      why: 'no user.settings.theme.error and no user.profile.error',
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

    expect(fallbackOf(initial, 'user.sign-in', 'verifying')).toEqual({
      why: 'nothing enters verifying, so it has no way back',
    })
    expect(fallbackOf(two, 'user.sign-in', 'sending')).toEqual({
      why: 'sending is entered from idle and sent: no single way back',
    })
    expect(fallbackOf(chained, 'user.sign-in', 'second')).toEqual({
      why: 'second is entered by the outcome of first, not by a control',
    })
    expect(fallbackOf(deep, 'user.sign-in', 'sending')).toEqual({
      why: 'sending is entered from outside its area (idle)',
    })
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

    expect(fallbackOf(byEvent, 'user.sign-in', 'loading')).toEqual({
      back: 'idle',
      error: 'user.sign-in.error',
    })
    expect(fallbackOf(parts, 'user.settings', 'saving')).toEqual({
      why: 'the controls that enter saving sit in different parts (user.settings.password, user.settings.email)',
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
