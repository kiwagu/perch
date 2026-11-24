import { describe, expect, it } from 'vitest'

import { sameValue } from './same-value'

describe('sameValue', () => {
  it('compares objects whatever the order of their keys', () => {
    expect(sameValue({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true)
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it('compares lists item by item, in order', () => {
    expect(sameValue([1, [2]], [1, [2]])).toBe(true)
    expect(sameValue([1, 2], [2, 1])).toBe(false)
    expect(sameValue([1], { 0: 1 })).toBe(false)
  })

  it('tells a value from its absence, and holds NaN to itself', () => {
    expect(sameValue(undefined, null)).toBe(false)
    expect(sameValue('a', 'a')).toBe(true)
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true)
  })
})
