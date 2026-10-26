import { describe, expect, it } from 'vitest'

import { withDerivedInputs } from '.'

const screen = (anchors: Record<string, unknown>) => ({ id: 'sample', anchors })

describe('withDerivedInputs', () => {
  it('says every field holds input, except one whose own change runs its action', () => {
    expect(
      withDerivedInputs(
        screen({
          'sample.form.title-input': { kind: 'input', binding: { model: 'thing.title' } },
          'sample.form.note-textarea': { kind: 'textarea' },
          'sample.page.kind-select': {
            kind: 'select',
            binding: [
              { model: 'thing.kind' },
              { action: 'thing.setKind', params: { kind: 'sample.page.kind-select' } },
            ],
          },
          'sample.form.save-button': {
            kind: 'button',
            binding: { action: 'thing.save', params: { title: 'sample.form.title-input' } },
          },
          'sample.page.heading': { kind: 'heading' },
        }),
      ),
    ).toEqual(
      screen({
        'sample.form.title-input': {
          kind: 'input',
          binding: { model: 'thing.title' },
          holdsInput: true,
        },
        'sample.form.note-textarea': { kind: 'textarea', holdsInput: true },
        'sample.page.kind-select': {
          kind: 'select',
          binding: [
            { model: 'thing.kind' },
            { action: 'thing.setKind', params: { kind: 'sample.page.kind-select' } },
          ],
          holdsInput: false,
        },
        'sample.form.save-button': {
          kind: 'button',
          binding: { action: 'thing.save', params: { title: 'sample.form.title-input' } },
        },
        'sample.page.heading': { kind: 'heading' },
      }),
    )
  })

  it('says a field submitted by a button holds input, though it binds the action too', () => {
    const anchors = withDerivedInputs(
      screen({
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
      }),
    )

    expect(anchors).toMatchObject({
      anchors: {
        'sample.form.email-input': { holdsInput: true },
        'sample.form.name-input': { holdsInput: true },
      },
    })
  })

  it('keeps what the file writes', () => {
    const anchors = { 'sample.form.title-input': { kind: 'input', holdsInput: false } }

    expect(withDerivedInputs(screen(anchors))).toEqual(screen(anchors))
  })

  it('leaves anything that is not a screen as it is', () => {
    expect(withDerivedInputs('nothing')).toBe('nothing')
  })
})
