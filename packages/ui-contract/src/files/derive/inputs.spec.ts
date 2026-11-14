import { describe, expect, it } from 'vitest'

import { screenFileSchema } from '../../schemas'
import type { Screen } from '../screens'

import { withDerivedInputs } from '.'

const SELECT = 'sample.page.kind-select'
const SEARCH_INPUT = 'sample.page.search-input'
const SEARCH_BUTTON = 'sample.page.search-button'

/** A screen at `/sample` over `anchors`, its flow one state `editing` that `on` gives events. */
function screenWith(
  anchors: Record<string, unknown>,
  on: Record<string, unknown> = {},
  frame = false,
): Screen {
  return screenFileSchema.parse({
    id: 'sample',
    title: 'Sample',
    description: 'A sample screen.',
    flag: null,
    ...(frame
      ? { frame: true, bindings: [] }
      : { bindings: [{ path: '/sample', roles: ['member'] }] }),
    entry: ['sample.page'],
    anchors: { 'sample.page': { kind: 'page' }, ...anchors },
    ...(frame ? {} : { flow: { initial: 'editing', states: { editing: { on } } } }),
  })
}

/** The branch of an event that moves to `to`, its search as given. */
const moves = (to: string, search?: Record<string, unknown>) => ({
  target: 'editing',
  actions: [{ type: 'navigate', params: search === undefined ? { to } : { to, search } }],
})

/** `holdsInput` of every anchor that carries it, by anchor. */
const holdsOf = (screen: Screen): Record<string, boolean | undefined> =>
  Object.fromEntries(
    Object.entries(screen.anchors)
      .filter(([, def]) => 'holdsInput' in def)
      .map(([anchor, def]) => [anchor, def.holdsInput]),
  )

const select = { kind: 'select', binding: { model: 'thing.kind' } }

/** A select whose own change runs its action. */
const applyingSelect = {
  kind: 'select',
  binding: [{ model: 'thing.kind' }, { action: 'thing.setKind', params: { kind: SELECT } }],
}

describe('withDerivedInputs', () => {
  it('says every field holds input, except one whose own change runs its action', () => {
    const screen = screenWith({
      'sample.form.title-input': { kind: 'input', binding: { model: 'thing.title' } },
      'sample.form.note-textarea': { kind: 'textarea' },
      [SELECT]: applyingSelect,
      'sample.form.save-button': {
        kind: 'button',
        binding: { action: 'thing.save', params: { title: 'sample.form.title-input' } },
      },
      'sample.page.heading': { kind: 'heading' },
    })

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({
      'sample.form.title-input': true,
      'sample.form.note-textarea': true,
      [SELECT]: false,
    })
  })

  it('says a field submitted by a button holds input, though it binds the action too', () => {
    const screen = screenWith({
      'sample.form.email-input': {
        kind: 'input',
        binding: [
          { action: 'platform.sign-in', params: { email: 'sample.form.email-input' } },
          { action: 'platform.sign-up', params: { email: 'sample.form.email-input' } },
        ],
      },
      'sample.form.name-input': {
        kind: 'input',
        binding: { action: 'platform.sign-up', params: { name: 'sample.form.name-input' } },
      },
      'sample.form.submit-button': {
        kind: 'button',
        binding: [
          { action: 'platform.sign-in', params: { email: 'sample.form.email-input' } },
          {
            action: 'platform.sign-up',
            params: { email: 'sample.form.email-input', name: 'sample.form.name-input' },
          },
        ],
      },
    })

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({
      'sample.form.email-input': true,
      'sample.form.name-input': true,
    })
  })

  it('derives the same with a search parameter the field starts with beside its action', () => {
    const screen = screenWith({
      'sample.form.email-input': {
        kind: 'input',
        binding: [
          { search: 'email' },
          { action: 'platform.reset', params: { email: 'sample.form.email-input' } },
        ],
      },
      'sample.form.submit-button': {
        kind: 'button',
        binding: { action: 'platform.reset', params: { email: 'sample.form.email-input' } },
      },
      [SELECT]: { kind: 'select', binding: { search: 'kind' } },
    })

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({
      'sample.form.email-input': true,
      [SELECT]: true,
    })
  })

  it("says a select holds no input when its own event moves its screen's search with itself", () => {
    const screen = screenWith(
      { [SELECT]: select },
      { [SELECT]: moves('/sample', { kind: { anchor: SELECT }, page: 1 }) },
    )

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({ [SELECT]: false })
  })

  it("says an input a button's move carries to the screen's path holds input", () => {
    const screen = screenWith(
      {
        [SEARCH_INPUT]: { kind: 'input', binding: { search: 'q' } },
        [SEARCH_BUTTON]: { kind: 'button' },
      },
      { [SEARCH_BUTTON]: moves('/sample', { q: { anchor: SEARCH_INPUT } }) },
    )

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({ [SEARCH_INPUT]: true })
  })

  it('says a select whose own event moves to another screen carrying itself holds input', () => {
    const screen = screenWith(
      { [SELECT]: select },
      { [SELECT]: moves('/elsewhere', { kind: { anchor: SELECT } }) },
    )

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({ [SELECT]: true })
  })

  it('says a select whose own move of the search leaves it out holds input', () => {
    const screen = screenWith({ [SELECT]: select }, { [SELECT]: moves('/sample', { page: 1 }) })

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({ [SELECT]: true })
  })

  it('says a select another control moves the search with as well holds input', () => {
    const screen = screenWith(
      { [SELECT]: select, 'sample.page.apply-button': { kind: 'button' } },
      {
        [SELECT]: moves('/sample', { kind: { anchor: SELECT }, page: 1 }),
        'sample.page.apply-button': moves('/sample', { kind: { anchor: SELECT } }),
      },
    )

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({ [SELECT]: true })
  })

  it('derives the action rule on the frame, which has no flow move', () => {
    const screen = screenWith({ [SELECT]: applyingSelect }, {}, true)

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({ [SELECT]: false })
  })

  it('keeps what the file writes', () => {
    const screen = screenWith(
      {
        [SELECT]: { ...select, holdsInput: true },
        'sample.form.title-input': { kind: 'input', holdsInput: false },
      },
      { [SELECT]: moves('/sample', { kind: { anchor: SELECT }, page: 1 }) },
    )

    expect(holdsOf(withDerivedInputs(screen))).toStrictEqual({
      [SELECT]: true,
      'sample.form.title-input': false,
    })
  })
})
