import { describe, expect, it } from 'vitest'

import type { Screen } from '../screens'

import { derivedDescriptionOf, describedOf } from './descriptions'
import type { Failure } from './failures'

const screenOf = (
  id: string,
  title: string,
  path: string,
  anchors: Screen['anchors'] = {},
): Screen => ({
  id,
  title,
  description: `The ${id} screen.`,
  bindings: [{ path, roles: ['guest'], history: 'push' }],
  flag: null,
  entry: [],
  anchors,
})

const SIGN_IN = screenOf('user.sign-in', 'Sign in', '/sign-in', {
  'user.sign-in.email-input': {
    kind: 'input',
    binding: { action: 'platform.sign-in', params: { email: 'user.sign-in.email-input' } },
  },
  'user.sign-in.submit-button': {
    kind: 'button',
    binding: [{ action: 'platform.sign-in' }, { action: 'platform.sign-up' }],
  },
  'user.sign-in.error': { kind: 'error', codes: ['invalid-credentials', 'failed'] },
})
const FORGOT = screenOf('user.forgot-password', 'Forgot the password', '/forgot-password')
const VERIFY_ERROR = 'user.verify-email.error'
/** A screen whose flow shows the failure of the link's request on the error beside a resend button. */
const VERIFY: Screen = {
  ...screenOf('user.verify-email', 'Verify the email', '/verify-email', {
    'user.verify-email.resend-button': { kind: 'button', binding: { action: 'platform.resend' } },
    [VERIFY_ERROR]: { kind: 'error', codes: ['failed'] },
  }),
  flow: {
    initial: 'verifying',
    states: {
      verifying: {
        invoke: {
          src: 'platform.verify-email',
          onDone: { target: 'done' },
          onError: {
            target: 'failed',
            actions: [{ type: 'show', params: { anchor: VERIFY_ERROR, codes: ['failed'] } }],
          },
        },
      },
      failed: { on: { 'user.verify-email.resend-button': { target: 'resending' } } },
      resending: {
        invoke: {
          src: 'platform.resend',
          onDone: { target: 'failed' },
          onError: {
            target: 'failed',
            actions: [{ type: 'show', params: { anchor: VERIFY_ERROR, codes: ['failed'] } }],
          },
        },
      },
      done: { type: 'final' },
    },
  },
}
const FAILURES: Readonly<Record<string, Failure>> = {
  'platform.verify-email': { codes: ['failed'], params: {} },
  'platform.resend': { codes: ['failed'], params: {} },
}
const CONTEXT = {
  failureOf: (action: string) => FAILURES[action],
  screens: [SIGN_IN, FORGOT, VERIFY],
  codes: {
    'invalid-credentials': {
      where: '`user.sign-in.error`',
      meaning: 'the email or the password is wrong',
    },
    failed: { where: '`user.sign-in.error`', meaning: 'any other failure' },
  },
}
const derived = (anchor: string, def: Screen['anchors'][string], screen = SIGN_IN) =>
  derivedDescriptionOf(anchor, def, screen, CONTEXT)

describe('derivedDescriptionOf', () => {
  it('names the screen for a heading, and the target screen for a link to a route', () => {
    expect(derived('user.sign-in.heading', { kind: 'heading' })).toBe('Names the screen `Sign in`.')
    expect(
      derived('user.sign-in.forgot-link', {
        kind: 'link',
        binding: { route: '/forgot-password' },
      }),
    ).toBe('Leads to `Forgot the password`.')
    expect(
      derived('user.sign-in.other-link', { kind: 'link', binding: { route: '/nowhere' } }),
    ).toBeUndefined()
    expect(derived('user.sign-in.email-input', { kind: 'input' })).toBeUndefined()
  })
  it('says a secret input holds a secret the user types, whether an action takes it or not', () => {
    expect(derived('user.sign-in.password-input', { kind: 'input', secret: true })).toBe(
      'A secret the user types, never shown (type password).',
    )
  })
  it("says why an error's actions did not go through, each code with its meaning", () => {
    expect(
      derived('user.sign-in.error', { kind: 'error', codes: ['invalid-credentials', 'failed'] }),
    ).toBe(
      'Why `platform.sign-in`, `platform.sign-up` did not go through: `invalid-credentials` (the email or the password is wrong), `failed` (any other failure).',
    )
    expect(derived('user.sign-in.other.error', { kind: 'error' })).toBeUndefined()
  })
  it('names the actions bound beside an error, then those its flow invokes against it, each once', () => {
    const error = VERIFY.anchors[VERIFY_ERROR]

    if (error === undefined) {
      throw new Error('the verify screen lost its error')
    }

    expect(derived(VERIFY_ERROR, error, VERIFY)).toBe(
      'Why `platform.resend`, `platform.verify-email` did not go through: `failed` (any other failure).',
    )
    expect(
      derived(VERIFY_ERROR, error, {
        ...VERIFY,
        anchors: { [VERIFY_ERROR]: error },
      }),
    ).toBe(
      'Why `platform.verify-email`, `platform.resend` did not go through: `failed` (any other failure).',
    )
  })
  it('keeps the sentence whole when an error has no action beside it, or no code', () => {
    expect(derived('user.sign-in.other.error', { kind: 'error', codes: ['failed'] })).toBe(
      'Why the action did not go through: `failed` (any other failure).',
    )
    expect(derived('user.sign-in.error', { kind: 'error', codes: [] })).toBe(
      'Why `platform.sign-in`, `platform.sign-up` did not go through.',
    )
  })
})

describe('describedOf', () => {
  it('keeps a written description, adds (type password) to a secret input once, falls back to the derived one', () => {
    expect(describedOf({ kind: 'heading', description: 'Written.' }, 'Derived.')).toBe('Written.')
    expect(describedOf({ kind: 'heading' }, 'Derived.')).toBe('Derived.')
    expect(
      describedOf({ kind: 'input', secret: true, description: 'The password.' }, undefined),
    ).toBe('The password (type password).')
    expect(
      describedOf(
        { kind: 'input', secret: true, description: 'The password (type password).' },
        undefined,
      ),
    ).toBe('The password (type password).')
    expect(describedOf({ kind: 'item' }, undefined)).toBeUndefined()
  })
})
