import { describe, expect, it } from 'vitest'

import { type Failure, flowSourcesOf } from '.'

const FAILURES: Readonly<Record<string, Failure>> = {
  'platform.verify-email': { codes: ['link-invalid', 'failed'], params: {} },
  'platform.resend': { codes: ['rate-limited', 'failed'], params: {} },
  'platform.open': { codes: [], params: {} },
  'platform.remove': { codes: ['not-admin', 'failed'], params: {} },
}
const failureOf = (action: string) => FAILURES[action]
const ERROR = 'user.verify-email.error'
const RESEND = 'user.verify-email.resend-button'

const sources = (
  flow: unknown,
  anchors: Record<string, unknown> = { [ERROR]: { kind: 'error' } },
) => flowSourcesOf({ id: 'user.verify-email', anchors, flow }, failureOf)

/** A flow offering the resend button, which enters `resending`, invoking `src` with `invoke`. */
const resending = (src: string, invoke: Record<string, unknown> = {}, initial = 'offered') => ({
  initial,
  states: {
    offered: { on: { [RESEND]: 'resending' } },
    resending: { invoke: { src, onDone: 'offered', ...invoke } },
  },
})

describe('flowSourcesOf', () => {
  it('lists the codes the flow shows on the error explicitly, in the short and the full form, anywhere', () => {
    const { shown } = sources({
      initial: 'a',
      states: {
        a: {
          entry: [{ show: { [ERROR]: ['passwords-differ'] } }],
          on: {
            [RESEND]: [
              {
                target: 'b',
                guard: 'g',
                actions: [
                  { type: 'show', params: { anchor: ERROR, codes: ['link-invalid', 'failed'] } },
                ],
              },
              'b',
            ],
          },
        },
        b: { exit: [{ show: { 'user.verify-email.message': ['sent'] } }] },
      },
    })

    expect(shown.get(ERROR)).toEqual(['passwords-differ', 'link-invalid', 'failed'])
    expect(shown.get('user.verify-email.message')).toEqual(['sent'])
  })

  it('reads the shows under states and regions named entry, exit or actions', () => {
    const show = (code: string) => [{ show: { [ERROR]: [code] } }]
    const { shown } = sources({
      initial: 'entry',
      states: {
        entry: { entry: show('a'), on: { [RESEND]: 'exit' } },
        exit: { exit: show('b'), on: { [RESEND]: { target: 'actions', actions: show('c') } } },
        actions: {
          type: 'parallel',
          states: {
            entry: { initial: 'exit', states: { exit: { entry: show('d') }, actions: {} } },
            exit: {
              initial: 'actions',
              states: { actions: { on: { [RESEND]: { target: 'entry', actions: show('e') } } } },
            },
            actions: { by: 'user.verify-email.remove-button', onError: { actions: show('f') } },
          },
        },
      },
    })

    expect(shown.get(ERROR)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('lists the actions whose written onError shows the error, with their input', () => {
    const { invoked } = sources({
      initial: 'verifying',
      states: {
        verifying: {
          invoke: {
            src: 'platform.verify-email',
            input: { token: { search: 'token' } },
            onDone: 'done',
            onError: { target: 'offered', actions: [{ show: ERROR }] },
          },
        },
        offered: { on: { [RESEND]: 'resending' } },
        resending: {
          invoke: {
            src: 'platform.resend',
            input: { email: 'user.verify-email.email-input' },
            onDone: 'offered',
            onError: [
              { target: 'offered', guard: 'g', actions: [{ show: { [ERROR]: ['rate-limited'] } }] },
              {
                target: 'offered',
                actions: [
                  { type: 'show', params: { anchor: 'user.verify-email.message', codes: ['x'] } },
                ],
              },
            ],
          },
        },
        done: { type: 'final' },
      },
    })

    expect(invoked.get(ERROR)).toEqual([
      { action: 'platform.verify-email', params: { token: { search: 'token' } } },
      { action: 'platform.resend', params: { email: 'user.verify-email.email-input' } },
    ])
  })

  it('lists an action the request pattern will show on the error, when it fails with codes', () => {
    expect(sources(resending('platform.resend')).invoked.get(ERROR)).toEqual([
      { action: 'platform.resend', params: {} },
    ])
    expect(sources(resending('platform.open')).invoked.get(ERROR)).toBeUndefined()
  })

  it('lists such an action only where the pattern shows its failure: a bare onError needs no way back', () => {
    // No onError: the pattern needs the way back too, which a state where its area starts lacks.
    expect(
      sources(resending('platform.resend', {}, 'resending')).invoked.get(ERROR),
    ).toBeUndefined()
    // A target alone keeps the default show, way back or not.
    expect(
      sources(resending('platform.resend', { onError: 'offered' }, 'resending')).invoked.get(ERROR),
    ).toEqual([{ action: 'platform.resend', params: {} }])
    // No error the failure shows on: neither the part's nor the screen's is declared.
    expect(
      sources(resending('platform.resend'), { 'user.verify-email.other.error': { kind: 'error' } })
        .invoked.size,
    ).toBe(0)
  })

  it('lists the action of a region written by its button whose onError shows the error', () => {
    const { invoked } = sources(
      {
        initial: 'viewing',
        states: {
          viewing: {
            type: 'parallel',
            states: {
              members: {
                by: 'user.verify-email.remove-button',
                onError: { actions: [{ show: ERROR }] },
              },
              other: { initial: 'idle', states: { idle: {} } },
            },
          },
        },
      },
      {
        [ERROR]: { kind: 'error' },
        'user.verify-email.remove-button': {
          kind: 'button',
          binding: { action: 'platform.remove', params: { identity: 'user.verify-email.item' } },
        },
      },
    )

    expect(invoked.get(ERROR)).toEqual([
      { action: 'platform.remove', params: { identity: 'user.verify-email.item' } },
    ])
  })

  it("lists the action of a region whose onError is bare on the error the pattern shows it on: its part's, else the screen's", () => {
    const BUTTON = 'user.verify-email.members.remove-button'
    const regionWith = (onError: unknown) =>
      sources(
        {
          initial: 'viewing',
          states: {
            viewing: {
              type: 'parallel',
              states: { members: { by: BUTTON, ...(onError === undefined ? {} : { onError }) } },
            },
          },
        },
        {
          [ERROR]: { kind: 'error' },
          [BUTTON]: { kind: 'button', binding: { action: 'platform.remove' } },
        },
      ).invoked

    expect(regionWith({ description: 'Back to idle.' }).get(ERROR)).toEqual([
      { action: 'platform.remove', params: {} },
    ])
    // Absent, its failure shows on the error of its part, which the screen does not declare.
    expect(regionWith(undefined).size).toBe(0)
  })

  it('finds nothing in a screen without a flow', () => {
    expect(sources(undefined)).toEqual({ shown: new Map(), invoked: new Map() })
  })
})
