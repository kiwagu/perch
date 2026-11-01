import { describe, expect, it } from 'vitest'

import { controlsOf } from '.'

describe('controlsOf', () => {
  it('lists the buttons bound to one action, with the error of their part', () => {
    expect(
      controlsOf({
        anchors: {
          'sample.form.add-button': {
            kind: 'button',
            binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
          },
          'sample.form.error': { kind: 'error' },
          'sample.list.delete-button': {
            kind: 'button',
            binding: [{ action: 'thing.deleteThing' }],
          },
          'sample.form.save-button': {
            kind: 'button',
            binding: [{ action: 'thing.createThing' }, { action: 'thing.renameThing' }],
          },
          'sample.form.share-select': {
            kind: 'select',
            binding: { action: 'platform.things.share' },
          },
          'sample.nav.home-button': { kind: 'button', binding: { route: '/' } },
        },
      }),
    ).toEqual([
      {
        anchor: 'sample.form.add-button',
        src: 'thing.createThing',
        input: { title: 'sample.form.title-input' },
        error: 'sample.form.error',
      },
      {
        anchor: 'sample.list.delete-button',
        src: 'thing.deleteThing',
        input: undefined,
        error: undefined,
      },
    ])
  })
})
