import { describe, expect, it } from 'vitest'

import { baseOf, isKnownAnchor, isSizeOption, sizeOptionOf, testIdFor } from './derive'

const SUFFIXES = ['confirm-button', 'cancel-button', 'option']

/** No list pages. */
const UNPAGED: ReadonlySet<string> = new Set()

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

    expect(isKnownAnchor('x.y.dialog', declared, SUFFIXES, UNPAGED)).toBe(true)
    expect(isKnownAnchor('x.y.dialog.confirm-button', declared, SUFFIXES, UNPAGED)).toBe(true)
    expect(isKnownAnchor('x.y.locale-select.option', declared, SUFFIXES, UNPAGED)).toBe(true)
    expect(isKnownAnchor('x.y.dialog.close-button', declared, SUFFIXES, UNPAGED)).toBe(false)
    expect(isKnownAnchor('x.z.dialog.confirm-button', declared, SUFFIXES, UNPAGED)).toBe(false)
    expect(isKnownAnchor('x.z.dialog', declared, SUFFIXES, UNPAGED)).toBe(false)
  })
  it("names a paged list's size options, and tells them from any other anchor", () => {
    const paged = new Set(['console.users.list'])

    expect(sizeOptionOf('console.users.list')).toBe('console.users.list.size-select.option')
    expect(isSizeOption('console.users.list.size-select.option', paged)).toBe(true)
    expect(isSizeOption('console.notes.list.size-select.option', paged)).toBe(false)
    expect(isSizeOption('console.users.list.size-select', paged)).toBe(false)
    expect(isSizeOption('console.users.list', paged)).toBe(false)
  })
  it('knows the size options of a paged list, and of no list that does not page', () => {
    const declared = new Set(['console.users.list', 'console.notes.list'])
    const paged = new Set(['console.users.list'])

    expect(isKnownAnchor('console.users.list.size-select.option', declared, SUFFIXES, paged)).toBe(
      true,
    )
    expect(isKnownAnchor('console.notes.list.size-select.option', declared, SUFFIXES, paged)).toBe(
      false,
    )
    expect(
      isKnownAnchor('console.users.list.size-select.option', declared, SUFFIXES, UNPAGED),
    ).toBe(false)
  })
})
