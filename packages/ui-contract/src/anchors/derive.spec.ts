import { describe, expect, it } from 'vitest'

import { baseOf, isKnownAnchor, testIdFor } from './derive'

const SUFFIXES = ['confirm-button', 'cancel-button', 'option']

describe('derived anchors', () => {
  it('builds a derived anchor from a base and a suffix', () => {
    expect(testIdFor('x.y.dialog', 'confirm-button')).toBe('x.y.dialog.confirm-button')
  })
  it('reads the base when the last segment is a suffix', () => {
    expect(baseOf('x.y.dialog.confirm-button', SUFFIXES)).toBe('x.y.dialog')
    expect(baseOf('x.y.dialog', SUFFIXES)).toBeUndefined()
  })
  it('knows a declared anchor and a declared base with a listed suffix', () => {
    const declared = new Set(['x.y.dialog', 'x.y.locale-select'])

    expect(isKnownAnchor('x.y.dialog', declared, SUFFIXES)).toBe(true)
    expect(isKnownAnchor('x.y.dialog.confirm-button', declared, SUFFIXES)).toBe(true)
    expect(isKnownAnchor('x.y.locale-select.option', declared, SUFFIXES)).toBe(true)
    expect(isKnownAnchor('x.y.dialog.close-button', declared, SUFFIXES)).toBe(false)
    expect(isKnownAnchor('x.z.dialog.confirm-button', declared, SUFFIXES)).toBe(false)
    expect(isKnownAnchor('x.z.dialog', declared, SUFFIXES)).toBe(false)
  })
})
