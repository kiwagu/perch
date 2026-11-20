import { describe, expect, it } from 'vitest'

import { withDerivedKindParts } from './kinds'
import { withDerivedPaging } from './paging'

const FILE = 'contract/domain/screens/sample.yaml'

const screenWith = (anchors: Record<string, unknown>) => ({ id: 'sample', anchors })

const anchorsOf = (value: unknown) => (value as { anchors: Record<string, unknown> }).anchors

const at4 = (anchors: Record<string, unknown>) => withDerivedKindParts(FILE, screenWith(anchors), 4)

describe('withDerivedKindParts', () => {
  it("derives a select's data value and its options", () => {
    const { value, problems } = at4({ 'sample.mode-select': { kind: 'select' } })

    expect(problems).toEqual([])
    expect(anchorsOf(value)['sample.mode-select']).toEqual({
      kind: 'select',
      dataValue: true,
      derived: ['option'],
    })
  })

  it("derives a secret input's visibility button", () => {
    const { value, problems } = at4({ 'sample.password-input': { kind: 'input', secret: true } })

    expect(problems).toEqual([])
    expect(anchorsOf(value)['sample.password-input']).toEqual({
      kind: 'input',
      secret: true,
      derived: ['visibility-button'],
    })
  })

  it("derives a dialog's and a confirmation's two answers, in order", () => {
    const { value, problems } = at4({
      'sample.leave-dialog': { kind: 'dialog', codes: ['unsent-changes'] },
      'sample.ask-confirmation': { kind: 'confirmation' },
    })

    expect(problems).toEqual([])
    expect(anchorsOf(value)).toEqual({
      'sample.leave-dialog': {
        kind: 'dialog',
        codes: ['unsent-changes'],
        derived: ['confirm-button', 'cancel-button'],
      },
      'sample.ask-confirmation': {
        kind: 'confirmation',
        derived: ['confirm-button', 'cancel-button'],
      },
    })
  })

  it('adds the parts after the suffixes an anchor writes, each once', () => {
    const { value, problems } = at4({
      'sample.mode-select': { kind: 'select', derived: ['badge'] },
      'sample.password-input': { kind: 'input', secret: true, derived: ['hint'] },
    })

    expect(problems).toEqual([])
    expect(anchorsOf(value)['sample.mode-select']).toMatchObject({ derived: ['badge', 'option'] })
    expect(anchorsOf(value)['sample.password-input']).toMatchObject({
      derived: ['hint', 'visibility-button'],
    })
  })

  it('leaves alone what its kind implies nothing of', () => {
    const anchors = {
      'sample.page': { kind: 'page' },
      'sample.title-input': { kind: 'input', derived: [] },
      'sample.notes-textarea': { kind: 'textarea', secret: true },
      'sample.save-button': { kind: 'button', dataValue: true },
      'sample.home-link': { kind: 'link', derived: ['range'] },
      'sample.no-def': 'not an anchor',
    }

    expect(at4(anchors)).toEqual({ value: screenWith(anchors), problems: [] })
    expect(withDerivedKindParts(FILE, 'no screen', 4)).toEqual({
      value: 'no screen',
      problems: [],
    })
    expect(withDerivedKindParts(FILE, { id: 'sample' }, 4)).toEqual({
      value: { id: 'sample' },
      problems: [],
    })
  })

  it('leaves a `derived` that is no list for the schema to refuse', () => {
    const anchors = { 'sample.mode-select': { kind: 'select', derived: 'option' } }

    expect(at4(anchors).value).toEqual(screenWith(anchors))
  })

  it('lists the parts of a paged list once whatever order the loader derives them in', () => {
    const list = { kind: 'list', source: { platform: 'accounts.list', paged: true } }
    const kinds = withDerivedKindParts(FILE, screenWith({ 'sample.list': list }), 4)
    const paged = withDerivedPaging(FILE, kinds.value)

    expect(anchorsOf(paged.value)['sample.list']).toMatchObject({
      derived: ['range', 'previous-link', 'next-link', 'size-select'],
    })
  })

  describe('from version 4 a file never writes them', () => {
    const refused = (anchors: Record<string, unknown>) => at4(anchors).problems

    it("refuses a select's data value, true or false, and its option", () => {
      expect(refused({ 'sample.mode-select': { kind: 'select', dataValue: true } })).toEqual([
        {
          file: FILE,
          message:
            'anchors["sample.mode-select"].dataValue: dataValue is derived from its kind; leave it out',
        },
      ])
      expect(refused({ 'sample.mode-select': { kind: 'select', dataValue: false } })).toHaveLength(
        1,
      )
      expect(refused({ 'sample.mode-select': { kind: 'select', derived: ['option'] } })).toEqual([
        {
          file: FILE,
          message:
            'anchors["sample.mode-select"].derived[0]: "option" is derived from its kind; leave it out',
        },
      ])
    })

    it("refuses a secret input's visibility button", () => {
      expect(
        refused({
          'sample.password-input': {
            kind: 'input',
            secret: true,
            derived: ['visibility-button'],
          },
        }),
      ).toEqual([
        {
          file: FILE,
          message:
            'anchors["sample.password-input"].derived[0]: "visibility-button" is derived from its kind; leave it out',
        },
      ])
    })

    it("refuses each of a dialog's and a confirmation's answers", () => {
      expect(
        refused({
          'sample.leave-dialog': { kind: 'dialog', derived: ['confirm-button', 'cancel-button'] },
          'sample.ask-confirmation': { kind: 'confirmation', derived: ['cancel-button'] },
        }).map(({ message }) => message),
      ).toEqual([
        'anchors["sample.leave-dialog"].derived[0]: "confirm-button" is derived from its kind; leave it out',
        'anchors["sample.leave-dialog"].derived[1]: "cancel-button" is derived from its kind; leave it out',
        'anchors["sample.ask-confirmation"].derived[0]: "cancel-button" is derived from its kind; leave it out',
      ])
    })

    it('derives the part all the same, once, beside the suffixes the anchor keeps', () => {
      const { value } = at4({
        'sample.mode-select': { kind: 'select', dataValue: true, derived: ['badge', 'option'] },
      })

      expect(anchorsOf(value)['sample.mode-select']).toEqual({
        kind: 'select',
        dataValue: true,
        derived: ['badge', 'option'],
      })
    })

    it('leaves a suffix that is not implied by the kind to the vocabulary', () => {
      expect(refused({ 'sample.mode-select': { kind: 'select', derived: ['badge'] } })).toEqual([])
      expect(
        refused({ 'sample.title-input': { kind: 'input', derived: ['visibility-button'] } }),
      ).toEqual([])
    })
  })

  describe('before version 4 the contract reads as it did', () => {
    const anchors = {
      'sample.mode-select': { kind: 'select', dataValue: true, derived: ['option'] },
      'sample.leave-dialog': { kind: 'dialog', derived: ['confirm-button', 'cancel-button'] },
      'sample.password-input': { kind: 'input', secret: true, derived: ['visibility-button'] },
      'sample.bare-select': { kind: 'select' },
      'sample.bare-dialog': { kind: 'dialog' },
      'sample.bare-input': { kind: 'input', secret: true },
    }

    it.each([1, 2, 3])('derives nothing and accepts what is written at version %i', (edition) => {
      expect(withDerivedKindParts(FILE, screenWith(anchors), edition)).toEqual({
        value: screenWith(anchors),
        problems: [],
      })
    })
  })
})
