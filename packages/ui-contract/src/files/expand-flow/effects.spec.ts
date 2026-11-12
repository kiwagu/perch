import { describe, expect, it } from 'vitest'

import { flowSchema } from '../../schemas'
import type { Control, Failure } from '../derive'

import { expandFlow, type FlowLookups } from '.'

const ERROR = 'user.sign-in.error'

const SIGN_IN = 'platform.sign-in'

const FAILURES: Readonly<Record<string, Failure>> = {
  [SIGN_IN]: {
    codes: ['invalid-credentials', 'email-not-verified', 'rate-limited', 'other-account', 'failed'],
    params: {},
  },
  'platform.reset-password': {
    codes: ['link-invalid', 'link-expired', 'password-rejected', 'rate-limited', 'failed'],
    params: {},
  },
}

const RESEND: Control = {
  anchor: 'user.sign-in.resend-button',
  src: SIGN_IN,
  input: undefined,
  error: ERROR,
}

const lookups = (failureOf: FlowLookups['failureOf']): FlowLookups => ({
  codesOf: (anchor) => (anchor === ERROR ? ['carried', 'failed'] : undefined),
  failureOf,
  controls: [RESEND],
  screen: 'user.sign-in',
  toast: undefined,
  platformToasts: {},
})

const LOOKUPS = lookups((action) => FAILURES[action])

const SHOW = { show: ERROR }

const shown = (codes: readonly string[]) => ({
  type: 'show',
  params: { anchor: ERROR, codes: [...codes] },
})

/**
 * A flow whose `trying` runs `src`, failing into the branches `onError`, with `guards`; the
 * submit button of `form` enters it by `submit`.
 */
const failing = (
  guards: Record<string, unknown>,
  onError: unknown,
  src = SIGN_IN,
  submit: unknown = 'trying',
) => ({
  initial: 'form',
  meta: { guards },
  states: {
    form: { on: { 'user.sign-in.submit-button': submit } },
    trying: { invoke: { src, onDone: 'done', onError } },
    done: { type: 'final' },
  },
})

/** The flow `expandFlow` makes, with the issues. */
function expanded(flow: unknown, with_ = LOOKUPS) {
  const { flow: out, issues } = expandFlow(flow, with_)

  return { flow: out as { states: { trying: { invoke: { onError: unknown } } } }, issues }
}

/** The codes each branch of the expanded `onError` shows on the error, in order. */
function shownOn(flow: unknown, with_ = LOOKUPS): Array<readonly string[] | undefined> {
  const { flow: out, issues } = expanded(flow, with_)
  const branches = out.states.trying.invoke.onError as Array<{
    actions?: Array<{ params: { codes: string[] } }>
  }>

  expect(issues).toEqual([])

  return branches.map(({ actions }) => actions?.[0]?.params.codes)
}

describe('show: <anchor> on the branches of an onError guarded by failure code', () => {
  it('splits the failure as the screen spells it out today: sign-in', () => {
    const written = failing({ emailNotVerified: 'the account is not verified' }, [
      {
        target: 'form',
        guard: 'emailNotVerified',
        actions: [{ show: { [ERROR]: ['email-not-verified'] } }],
      },
      {
        target: 'form',
        actions: [
          { show: { [ERROR]: ['invalid-credentials', 'rate-limited', 'other-account', 'failed'] } },
        ],
      },
    ])
    const byCode = failing({ emailNotVerified: { codes: ['email-not-verified'] } }, [
      { target: 'form', guard: 'emailNotVerified', actions: [SHOW] },
      { target: 'form', actions: [SHOW] },
    ])

    expect(expanded(byCode).flow.states).toEqual(expanded(written).flow.states)
    expect(shownOn(byCode)).toEqual([
      ['email-not-verified'],
      ['invalid-credentials', 'rate-limited', 'other-account', 'failed'],
    ])
  })
  it('narrows a two-branch list: reset-password', () => {
    expect(
      shownOn(
        failing(
          { linkUnusable: { codes: ['link-invalid', 'link-expired'] } },
          [
            { target: 'done', guard: 'linkUnusable', actions: [SHOW] },
            { target: 'form', actions: [SHOW] },
          ],
          'platform.reset-password',
        ),
      ),
    ).toEqual([
      ['link-invalid', 'link-expired'],
      ['password-rejected', 'rate-limited', 'failed'],
    ])
  })
  it('gives a later branch with a sentence guard or none what the code-guarded ones before leave', () => {
    const guards = {
      limited: { codes: ['rate-limited'] },
      foreign: 'the account is another one',
      unverified: { codes: ['email-not-verified', 'other-account'] },
    }

    expect(
      shownOn(
        failing(guards, [
          { target: 'form', guard: 'limited', actions: [SHOW] },
          { target: 'form', guard: 'foreign', actions: [SHOW] },
          { target: 'form', actions: [SHOW] },
        ]),
      ),
    ).toEqual([
      ['rate-limited'],
      ['invalid-credentials', 'email-not-verified', 'other-account', 'failed'],
      ['invalid-credentials', 'email-not-verified', 'other-account', 'failed'],
    ])
    expect(
      shownOn(
        failing(guards, [
          { target: 'form', guard: 'foreign', actions: [SHOW] },
          { target: 'form', guard: 'unverified', actions: [SHOW] },
          { target: 'form', guard: 'limited', actions: [SHOW] },
          { target: 'form', actions: [SHOW] },
        ]),
      ),
    ).toEqual([
      ['invalid-credentials', 'email-not-verified', 'rate-limited', 'other-account', 'failed'],
      ['email-not-verified', 'other-account'],
      ['rate-limited'],
      ['invalid-credentials', 'failed'],
    ])
  })
  it('leaves a branch before any guard by failure code whole, and a show that names its codes', () => {
    expect(
      shownOn(
        failing({ foreign: 'the account is another one', limited: { codes: ['rate-limited'] } }, [
          { target: 'form', guard: 'foreign', actions: [SHOW] },
          { target: 'form', guard: 'limited', actions: [{ show: { [ERROR]: ['failed'] } }] },
          { target: 'form', actions: [SHOW] },
        ]),
      ),
    ).toEqual([
      ['invalid-credentials', 'email-not-verified', 'rate-limited', 'other-account', 'failed'],
      ['failed'],
      ['invalid-credentials', 'email-not-verified', 'other-account', 'failed'],
    ])
  })
  it('takes a guard the schema refuses for a sentence, and one outside an onError changes nothing', () => {
    const flow = failing(
      { empty: { codes: [] }, limited: { codes: ['rate-limited'] } },
      [
        { target: 'form', guard: 'empty', actions: [SHOW] },
        { target: 'form', actions: [SHOW] },
      ],
      SIGN_IN,
      { target: 'trying', guard: 'limited', actions: [SHOW] },
    )
    const { flow: out, issues } = expanded(flow)

    expect(issues).toEqual([])
    expect(out.states.trying.invoke.onError).toEqual([
      { target: 'form', guard: 'empty', actions: [shown(FAILURES[SIGN_IN]?.codes ?? [])] },
      { target: 'form', actions: [shown(FAILURES[SIGN_IN]?.codes ?? [])] },
    ])
    expect(out).toMatchObject({
      states: {
        form: { on: { 'user.sign-in.submit-button': { actions: [shown(['carried', 'failed'])] } } },
      },
    })
  })
  it('names a branch the guards before it leave no code to show', () => {
    const { issues } = expanded(
      failing({ all: { codes: FAILURES[SIGN_IN]?.codes ?? [] } }, [
        { target: 'form', guard: 'all', actions: [SHOW] },
        { target: 'form', actions: [SHOW] },
      ]),
    )

    expect(issues).toEqual([
      {
        at: ['flow', 'states', 'trying', 'invoke', 'onError', 1, 'actions', 0, 'show'],
        message: `the branches guarded by failure code before this one take every code ${SIGN_IN} fails with; name the ones it shows here: show: { ${ERROR}: [<code>] }`,
      },
    ])
  })
  it("shows the guard's codes while the action's file does not load, the anchor's on the rest", () => {
    expect(
      shownOn(
        failing({ limited: { codes: ['rate-limited'] } }, [
          { target: 'form', guard: 'limited', actions: [SHOW] },
          { target: 'form', actions: [SHOW] },
        ]),
        lookups(() => 'unloaded'),
      ),
    ).toEqual([['rate-limited'], ['carried', 'failed']])
  })
  it('narrows the onError of a region written by its button the same way', () => {
    const { flow, issues } = expandFlow(
      {
        initial: 'viewing',
        meta: { guards: { limited: { codes: ['rate-limited'] } } },
        states: {
          viewing: {
            type: 'parallel',
            states: {
              resend: {
                by: RESEND.anchor,
                onError: [{ guard: 'limited', actions: [SHOW] }, { actions: [SHOW] }],
              },
              other: { initial: 'idle', states: { idle: {} } },
            },
          },
        },
      },
      LOOKUPS,
    )

    expect(issues).toEqual([])
    expect(flow).toMatchObject({
      states: {
        viewing: {
          states: {
            resend: {
              states: {
                running: {
                  invoke: {
                    onError: [
                      { target: 'idle', guard: 'limited', actions: [shown(['rate-limited'])] },
                      {
                        target: 'idle',
                        actions: [
                          shown([
                            'invalid-credentials',
                            'email-not-verified',
                            'other-account',
                            'failed',
                          ]),
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    })
  })
  it('makes a flow the canonical schema takes, the guard by failure code kept', () => {
    const { flow } = expanded(
      failing({ limited: { codes: ['rate-limited'] } }, [
        { target: 'form', guard: 'limited', actions: [SHOW] },
        { target: 'form', actions: [SHOW] },
      ]),
    )

    expect(flowSchema.safeParse(flow).success).toBe(true)
    expect(flow).toMatchObject({ meta: { guards: { limited: { codes: ['rate-limited'] } } } })
  })
})
