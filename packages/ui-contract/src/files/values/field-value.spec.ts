import { describe, expect, it } from 'vitest'

import type { Screen } from '../screens'

import { fieldValueOf } from './field-value'
import { EMAIL, MODEL, NEW_PASSWORD, PLATFORM } from './values.fixture'

const EMAIL_INPUT = 'user.sign-in.email-input'
const PASSWORD_INPUT = 'user.sign-in.password-input'

/**
 * A sign-in screen: the email input starts with the route's `email` (bounded, no format) and
 * passes sign-in's email itself and sign-up's through the submit button; the password input
 * passes sign-in's password and sign-up's new one; a search input starts with `q` alone; a
 * button passes an item, which is no field, to a parameter.
 */
const SCREEN: Screen = {
  id: 'user.sign-in',
  title: 'Sign in',
  description: 'Signs this device in, or creates an account.',
  bindings: [
    {
      path: '/sign-in',
      roles: ['guest'],
      history: 'push',
      search: {
        type: 'object',
        properties: {
          email: { type: 'string', maxLength: 254 },
          q: { type: 'string', maxLength: 20 },
        },
        additionalProperties: false,
      },
    },
  ],
  flag: null,
  entry: [EMAIL_INPUT],
  anchors: {
    [EMAIL_INPUT]: {
      kind: 'input',
      binding: [
        { search: 'email' },
        { action: 'platform.sign-in', params: { email: EMAIL_INPUT } },
      ],
    },
    [PASSWORD_INPUT]: {
      kind: 'input',
      binding: [
        { action: 'platform.sign-in', params: { password: PASSWORD_INPUT } },
        { action: 'platform.sign-up', params: { password: PASSWORD_INPUT } },
      ],
    },
    'user.sign-in.name-input': { kind: 'input', binding: { model: 'profile.name' } },
    'user.sign-in.q-input': { kind: 'input', binding: { search: 'q' } },
    'user.sign-in.note-textarea': { kind: 'textarea' },
    'user.sign-in.account-item': { kind: 'item', dataId: 'the account' },
    'user.sign-in.submit-button': {
      kind: 'button',
      binding: { action: 'platform.sign-up', params: { email: EMAIL_INPUT } },
    },
    'user.sign-in.pick-button': {
      kind: 'button',
      binding: { action: 'platform.accounts.list', params: { q: 'user.sign-in.account-item' } },
    },
  },
}

const takenBy = (anchor: string) => fieldValueOf(anchor, SCREEN, PLATFORM, MODEL)

describe('fieldValueOf', () => {
  it('gives a field the value of the parameters that take it, the search it starts with aside', () => {
    expect(takenBy(EMAIL_INPUT)).toStrictEqual(EMAIL)
  })
  it('gives a field two parameters of different values take the loosest of them', () => {
    expect(takenBy(PASSWORD_INPUT)).toStrictEqual({ type: 'string', minLength: 1 })
  })
  it('gives a field bound to the model the value of its field', () => {
    expect(takenBy('user.sign-in.name-input')).toStrictEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
  })
  it('gives no value to a field bound to a search parameter alone, or to nothing', () => {
    expect(takenBy('user.sign-in.q-input')).toBeUndefined()
    expect(takenBy('user.sign-in.note-textarea')).toBeUndefined()
  })
  it('gives no value to an anchor that is no field, even one a parameter takes', () => {
    expect(takenBy('user.sign-in.submit-button')).toBeUndefined()
    expect(takenBy('user.sign-in.account-item')).toBeUndefined()
    expect(takenBy('user.sign-in.missing-input')).toBeUndefined()
  })
  it('gives a confirmation the value of the input it confirms, which it has none of as written', () => {
    const CONFIRMATION = 'user.sign-in.password-confirmation-input'
    const NEW_PASSWORD_INPUT = 'user.sign-in.new-password-input'
    const confirming = (confirms?: string) =>
      fieldValueOf(
        CONFIRMATION,
        {
          ...SCREEN,
          anchors: {
            ...SCREEN.anchors,
            [NEW_PASSWORD_INPUT]: {
              kind: 'input',
              secret: true,
              binding: { action: 'platform.sign-up', params: { password: NEW_PASSWORD_INPUT } },
            },
            [CONFIRMATION]: {
              kind: 'input',
              secret: true,
              ...(confirms === undefined ? {} : { confirms }),
            },
          },
        },
        PLATFORM,
        MODEL,
      )

    expect(confirming()).toBeUndefined()
    expect(confirming(PASSWORD_INPUT)).toStrictEqual(takenBy(PASSWORD_INPUT))
    expect(confirming(NEW_PASSWORD_INPUT)).toStrictEqual(NEW_PASSWORD)
    expect(confirming('user.sign-in.missing-input')).toBeUndefined()
  })
})
