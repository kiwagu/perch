import { describe, expect, it } from 'vitest'

import { percentile } from './percentile'

describe('percentile', () => {
  it('takes the nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5)
    expect(Number.isNaN(percentile([], 0.5))).toBe(true)
  })
})
