import { describe, expect, it } from 'vitest'

import { type Failure, withDerivedErrors } from '.'

const FAILURES: Readonly<Record<string, Failure>> = {
  'thing.createThing': {
    codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
    params: { title: ['title-required', 'title-too-long'] },
  },
  'thing.deleteThing': { codes: ['forbidden', 'failed'], params: {} },
  'thing.renameThing': {
    codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
    params: { title: ['title-required', 'title-too-long'] },
  },
  'platform.things.share': { codes: ['not-allowed', 'rate-limited', 'failed'], params: {} },
}

const failureOf = (action: string) => FAILURES[action]

/** A screen whose anchors are `anchors`, its error anchors derived. */
const derived = (anchors: Record<string, unknown>) =>
  (withDerivedErrors({ id: 'sample', anchors }, failureOf) as { anchors: Record<string, unknown> })
    .anchors

describe('withDerivedErrors', () => {
  it('gives an error the codes of the failures its part binds, each once, failed last', () => {
    expect(
      derived({
        'sample.form.delete-button': { kind: 'button', binding: { action: 'thing.deleteThing' } },
        'sample.form.share-button': {
          kind: 'button',
          binding: [{ action: 'thing.createThing' }, { action: 'platform.things.share' }],
        },
        'sample.form.error': { kind: 'error' },
        'sample.other.save-button': { kind: 'button', binding: { action: 'thing.renameThing' } },
        'sample.form.row.save-button': { kind: 'button', binding: { action: 'thing.renameThing' } },
      })['sample.form.error'],
    ).toEqual({
      kind: 'error',
      codes: [
        'forbidden',
        'title-required',
        'title-too-long',
        'not-allowed',
        'rate-limited',
        'failed',
      ],
    })
  })

  it('maps a code of a field to the control its binding passes, unless two pass two controls', () => {
    const anchors = {
      'sample.form.title-input': { kind: 'input' },
      'sample.form.note-textarea': { kind: 'textarea' },
      'sample.form.item': { kind: 'item' },
      'sample.form.add-button': {
        kind: 'button',
        binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
      },
      'sample.form.error': { kind: 'error' },
    }

    expect(derived(anchors)['sample.form.error']).toEqual({
      kind: 'error',
      codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
      fields: {
        'title-required': 'sample.form.title-input',
        'title-too-long': 'sample.form.title-input',
      },
    })
    expect(
      derived({
        ...anchors,
        'sample.form.rename-button': {
          kind: 'button',
          binding: { action: 'thing.renameThing', params: { title: 'sample.form.note-textarea' } },
        },
      })['sample.form.error'],
    ).toEqual({ kind: 'error', codes: ['forbidden', 'title-required', 'title-too-long', 'failed'] })
    expect(
      derived({
        ...anchors,
        'sample.form.add-button': {
          kind: 'button',
          binding: { action: 'thing.createThing', params: { title: 'sample.form.item' } },
        },
      })['sample.form.error'],
    ).toEqual({ kind: 'error', codes: ['forbidden', 'title-required', 'title-too-long', 'failed'] })
  })

  it('keeps the codes and the fields a file writes, and derives fields only for its codes', () => {
    const anchors = {
      'sample.form.title-input': { kind: 'input' },
      'sample.form.add-button': {
        kind: 'button',
        binding: { action: 'thing.createThing', params: { title: 'sample.form.title-input' } },
      },
    }

    expect(
      derived({ ...anchors, 'sample.form.error': { kind: 'error', codes: ['title-too-long'] } })[
        'sample.form.error'
      ],
    ).toEqual({
      kind: 'error',
      codes: ['title-too-long'],
      fields: { 'title-too-long': 'sample.form.title-input' },
    })
    expect(
      derived({
        ...anchors,
        'sample.form.error': { kind: 'error', fields: { failed: 'sample.form.title-input' } },
      })['sample.form.error'],
    ).toEqual({
      kind: 'error',
      codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
      fields: { failed: 'sample.form.title-input' },
    })
  })

  it('leaves an error whose part binds no action, and every other anchor, as written', () => {
    const anchors = {
      'sample.form.error': { kind: 'error', description: 'Nothing fails here.' },
      'sample.form.save-button': { kind: 'button', binding: { model: 'thing.title' } },
    }

    expect(derived(anchors)).toEqual(anchors)
  })
})
