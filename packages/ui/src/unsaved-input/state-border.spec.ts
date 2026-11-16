import { describe, expect, it } from 'vitest'

import { stateBorder } from './state-border'

describe('stateBorder', () => {
  it('colors the border of an unsaved and a saved field unless it is invalid, and focus only of a field with no state', () => {
    const classes = stateBorder(true).split(' ')

    expect(classes).toEqual([
      'data-[state=unsaved]:not-aria-invalid:border-warning',
      'data-[state=saved]:not-aria-invalid:border-success',
      'focus-visible:not-data-[state]:not-aria-invalid:border-ring',
    ])
  })

  it('keeps only the focus color when the field marks no state', () => {
    expect(stateBorder(false)).toBe('focus-visible:border-ring')
  })

  it('changes nothing but the border color', () => {
    for (const marks of [true, false]) {
      for (const name of stateBorder(marks).split(' ')) {
        expect(name).toMatch(/:border-(warning|success|ring)$/)
      }
    }
  })
})
