import { describe, expect, it } from 'vitest'

import { byText, compareText } from './text'

describe('text ordering', () => {
  it('ignores case and accents and orders numbers naturally', () => {
    expect(compareText('ann', 'Ann')).toBe(0)
    expect(compareText('Élan', 'elan')).toBe(0)
    expect(['item 10', 'item 2', 'Item 1'].toSorted(compareText)).toEqual([
      'Item 1',
      'item 2',
      'item 10',
    ])
  })

  it('sorts records by a selected text field', () => {
    const people = [{ name: 'bob' }, { name: 'Ann' }]

    expect(people.toSorted(byText((person) => person.name))).toEqual([
      { name: 'Ann' },
      { name: 'bob' },
    ])
  })
})
