import { describe, expect, it } from 'vitest'

import { partOf, withDerivedParams } from './form-params'

const FILE = 'contract/domain/screens/sign-in.yaml'
const SIGN_IN = 'platform.sign-in'
const SIGN_UP = 'platform.sign-up'

const field = (anchor: string, action: string, param: string) => ({
  kind: 'input',
  binding: { action, params: { [param]: anchor } },
})

const FIELDS = {
  'user.sign-in.email-input': {
    kind: 'input',
    binding: [
      { action: SIGN_IN, params: { email: 'user.sign-in.email-input' } },
      { action: SIGN_UP, params: { email: 'user.sign-in.email-input' } },
    ],
  },
  'user.sign-in.password-input': {
    kind: 'input',
    binding: [
      { action: SIGN_IN, params: { password: 'user.sign-in.password-input' } },
      { action: SIGN_UP, params: { password: 'user.sign-in.password-input' } },
    ],
  },
  'user.sign-in.name-input': field('user.sign-in.name-input', SIGN_UP, 'name'),
}

const derived = (anchors: Record<string, unknown>) =>
  withDerivedParams(FILE, { id: 'user.sign-in', anchors })

const bindingOf = (result: { value: unknown }, anchor: string) =>
  (result.value as { anchors: Record<string, { binding: unknown }> }).anchors[anchor]?.binding

describe('partOf', () => {
  it('is the anchor without its last segment', () => {
    expect(partOf('user.settings.password.save-button')).toBe('user.settings.password')
    expect(partOf('user.sign-in.submit-button')).toBe('user.sign-in')
  })
})

describe('withDerivedParams', () => {
  it('gives a button the union of the params the fields of its part pass for its action', () => {
    const result = derived({
      ...FIELDS,
      'user.sign-in.submit-button': {
        kind: 'button',
        binding: [
          { action: SIGN_IN },
          { action: SIGN_UP, params: { locale: 'app-shell.locale-select' } },
        ],
      },
    })

    expect(result.problems).toEqual([])
    expect(bindingOf(result, 'user.sign-in.submit-button')).toEqual([
      {
        action: SIGN_IN,
        params: { email: 'user.sign-in.email-input', password: 'user.sign-in.password-input' },
      },
      {
        action: SIGN_UP,
        params: {
          email: 'user.sign-in.email-input',
          password: 'user.sign-in.password-input',
          name: 'user.sign-in.name-input',
          locale: 'app-shell.locale-select',
        },
      },
    ])
  })

  it('keeps a written param over a derived one, key by key, and reports nothing', () => {
    const result = derived({
      ...FIELDS,
      'user.sign-in.submit-button': {
        kind: 'button',
        binding: { action: SIGN_IN, params: { email: 'user.sign-in.name-input' } },
      },
    })

    expect(result.problems).toEqual([])
    expect(bindingOf(result, 'user.sign-in.submit-button')).toEqual({
      action: SIGN_IN,
      params: { email: 'user.sign-in.name-input', password: 'user.sign-in.password-input' },
    })
  })

  it('takes only the fields of the same part, and only a button', () => {
    const result = derived({
      'user.settings.password.new-password-input': field(
        'user.settings.password.new-password-input',
        'platform.change-password',
        'password',
      ),
      'user.settings.email.password-input': field(
        'user.settings.email.password-input',
        'platform.change-password',
        'currentPassword',
      ),
      'user.settings.password.save-button': {
        kind: 'button',
        binding: { action: 'platform.change-password' },
      },
      'user.settings.password.rules-select': {
        kind: 'select',
        binding: { action: 'platform.change-password' },
      },
    })

    expect(bindingOf(result, 'user.settings.password.save-button')).toEqual({
      action: 'platform.change-password',
      params: { password: 'user.settings.password.new-password-input' },
    })
    expect(bindingOf(result, 'user.settings.password.rules-select')).toEqual({
      action: 'platform.change-password',
    })
  })

  it('refuses two fields passing one param with different values', () => {
    const result = derived({
      'user.sign-in.email-input': field('user.sign-in.email-input', SIGN_IN, 'email'),
      'user.sign-in.other-input': field('user.sign-in.other-input', SIGN_IN, 'email'),
      'user.sign-in.submit-button': { kind: 'button', binding: { action: SIGN_IN } },
    })

    expect(result.problems).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.submit-button"].binding.params.email: both user.sign-in.email-input and user.sign-in.other-input pass it to platform.sign-in: write the button\'s params',
      },
    ])
    expect(bindingOf(result, 'user.sign-in.submit-button')).toEqual({ action: SIGN_IN })
  })

  it('places a conflict of a listed binding at its index, and none on a param the button writes', () => {
    const conflicting = {
      'user.sign-in.email-input': field('user.sign-in.email-input', SIGN_UP, 'email'),
      'user.sign-in.other-input': field('user.sign-in.other-input', SIGN_UP, 'email'),
    }
    const listed = derived({
      ...conflicting,
      'user.sign-in.submit-button': {
        kind: 'button',
        binding: [{ action: SIGN_IN }, { action: SIGN_UP }],
      },
    })
    const written = derived({
      ...conflicting,
      'user.sign-in.submit-button': {
        kind: 'button',
        binding: { action: SIGN_UP, params: { email: 'user.sign-in.other-input' } },
      },
    })

    expect(listed.problems.map(({ message }) => message)).toEqual([
      'anchors["user.sign-in.submit-button"].binding[1].params.email: both user.sign-in.email-input and user.sign-in.other-input pass it to platform.sign-up: write the button\'s params',
    ])
    expect(written.problems).toEqual([])
    expect(bindingOf(written, 'user.sign-in.submit-button')).toEqual({
      action: SIGN_UP,
      params: { email: 'user.sign-in.other-input' },
    })
  })

  it('leaves a button with no field passing anything, and a screen that is not a record, as written', () => {
    const anchors = {
      'user.sign-in.submit-button': { kind: 'button', binding: { action: SIGN_IN } },
    }

    expect(derived(anchors)).toEqual({ value: { id: 'user.sign-in', anchors }, problems: [] })
    expect(withDerivedParams(FILE, 'no')).toEqual({ value: 'no', problems: [] })
  })
})
