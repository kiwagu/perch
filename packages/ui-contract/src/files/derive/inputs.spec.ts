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

  it('keeps what the file writes', () => {
    const anchors = { 'sample.form.title-input': { kind: 'input', holdsInput: false } }

    expect(withDerivedInputs(screen(anchors))).toEqual(screen(anchors))
  })

  it('leaves anything that is not a screen as it is', () => {
    expect(withDerivedInputs('nothing')).toBe('nothing')
  })
})
