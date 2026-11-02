import { describe, expect, it } from 'vitest'

import { compositeAnchorsOf, withDerivedComposites } from './composites'

const RULES = {
  description: 'The rules a new password keeps.',
  list: 'password-rule-list',
  itemState: 'met',
  items: { length: '10 to 35 characters.', digit: 'At least one digit.' },
}
const COMPOSITES = { 'password-rules': RULES }
const FILE = 'contract/domain/screens/sign-in.yaml'

const screen = (anchors: Record<string, unknown>) => ({ id: 'user.sign-in', anchors })

const derived = (anchors: Record<string, unknown>) =>
  withDerivedComposites(FILE, screen(anchors), COMPOSITES)

const anchorsOf = (result: { value: unknown }) =>
  (result.value as { anchors: Record<string, unknown> }).anchors

describe('compositeAnchorsOf', () => {
  it('names the list by the screen and each item by its name', () => {
    expect(compositeAnchorsOf('user.sign-in', RULES)).toEqual({
      list: 'user.sign-in.password-rule-list',
      items: {
        length: 'user.sign-in.password-rule-list.length-item',
        digit: 'user.sign-in.password-rule-list.digit-item',
      },
    })
  })
})

describe('withDerivedComposites', () => {
  const input = { kind: 'input', secret: true, composite: 'password-rules' }

  it('derives the list and its items after the input that opted in, each marked derivedFrom', () => {
    const result = derived({
      'user.sign-in.email-input': { kind: 'input' },
      'user.sign-in.password-input': input,
      'user.sign-in.submit-button': { kind: 'button' },
    })

    expect(result.problems).toEqual([])
    expect(Object.keys(anchorsOf(result))).toEqual([
      'user.sign-in.email-input',
      'user.sign-in.password-input',
      'user.sign-in.password-rule-list',
      'user.sign-in.password-rule-list.length-item',
      'user.sign-in.password-rule-list.digit-item',
      'user.sign-in.submit-button',
    ])
    expect(anchorsOf(result)['user.sign-in.password-rule-list']).toEqual({
      kind: 'list',
      description: 'The rules a new password keeps.',
      derivedFrom: { composite: 'password-rules' },
    })
    expect(anchorsOf(result)['user.sign-in.password-rule-list.digit-item']).toEqual({
      kind: 'item',
      description: 'At least one digit.',
      states: ['met'],
      derivedFrom: { composite: 'password-rules', item: 'digit' },
    })
    expect(anchorsOf(result)['user.sign-in.password-input']).toEqual(input)
  })

  it('refuses an unknown composite, and the opt-in on anything but a secret input', () => {
    expect(
      derived({ 'user.sign-in.password-input': { ...input, composite: 'rules' } }).problems,
    ).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.password-input"].composite: "rules" is not a composite of platform.yaml',
      },
    ])
    expect(
      derived({ 'user.sign-in.password-input': { kind: 'input', composite: 'password-rules' } })
        .problems,
    ).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.password-input"].composite: only a secret input opts into a composite',
      },
    ])
    expect(
      derived({ 'user.sign-in.rules-list': { kind: 'list', composite: 'password-rules' } })
        .problems,
    ).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.rules-list"].composite: only a secret input opts into a composite',
      },
    ])
  })

  it('refuses a written anchor whose id the composite derives, and a second opt-in on one screen', () => {
    expect(
      derived({
        'user.sign-in.password-input': input,
        'user.sign-in.password-rule-list': { kind: 'list', description: 'Written.' },
      }).problems,
    ).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.password-rule-list"]: derived by the composite password-rules of user.sign-in.password-input: a written anchor never doubles a derived one',
      },
    ])
    expect(
      derived({
        'user.sign-in.password-input': input,
        'user.sign-in.password-confirmation-input': input,
      }).problems,
    ).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.password-confirmation-input"].composite: the composite password-rules is derived once per screen; user.sign-in.password-input opted in already',
      },
    ])
  })

  it('refuses two composites deriving one anchor: the earlier keeps its anchors, the later inserts none', () => {
    const OTHER = {
      description: 'The rules of another password.',
      list: 'password-rule-list',
      itemState: 'met',
      items: { length: '12 characters at least.', upper: 'An upper-case letter.' },
    }
    const result = withDerivedComposites(
      FILE,
      screen({
        'user.sign-in.password-input': input,
        'user.sign-in.new-password-input': {
          kind: 'input',
          secret: true,
          composite: 'other-rules',
        },
      }),
      { ...COMPOSITES, 'other-rules': OTHER },
    )
    const doubled = (id: string) => ({
      file: FILE,
      message: `anchors["user.sign-in.new-password-input"].composite: the composite other-rules derives ${id}, which the composite password-rules of user.sign-in.password-input derives already: two composites never derive one anchor`,
    })

    expect(result.problems).toEqual([
      doubled('user.sign-in.password-rule-list'),
      doubled('user.sign-in.password-rule-list.length-item'),
    ])
    expect(Object.keys(anchorsOf(result))).toEqual([
      'user.sign-in.password-input',
      'user.sign-in.password-rule-list',
      'user.sign-in.password-rule-list.length-item',
      'user.sign-in.password-rule-list.digit-item',
      'user.sign-in.new-password-input',
    ])
    expect(anchorsOf(result)['user.sign-in.password-rule-list']).toEqual({
      kind: 'list',
      description: 'The rules a new password keeps.',
      derivedFrom: { composite: 'password-rules' },
    })
    expect(anchorsOf(result)['user.sign-in.password-rule-list.length-item']).toEqual({
      kind: 'item',
      description: '10 to 35 characters.',
      states: ['met'],
      derivedFrom: { composite: 'password-rules', item: 'length' },
    })
  })

  it('refuses a derivedFrom the file writes, and takes it away', () => {
    const result = derived({
      'user.sign-in.rules-list': { kind: 'list', derivedFrom: { composite: 'password-rules' } },
    })

    expect(result.problems).toEqual([
      {
        file: FILE,
        message:
          'anchors["user.sign-in.rules-list"].derivedFrom: derivedFrom is derived from a composite of the platform: a screen file never writes it',
      },
    ])
    expect(anchorsOf(result)['user.sign-in.rules-list']).toEqual({ kind: 'list' })
  })

  it('leaves a screen without an opt-in, and one that is not a record, as it is', () => {
    const anchors = { 'user.sign-in.email-input': { kind: 'input' } }

    expect(derived(anchors)).toEqual({ value: screen(anchors), problems: [] })
    expect(withDerivedComposites(FILE, 'no', COMPOSITES)).toEqual({ value: 'no', problems: [] })
  })
})
