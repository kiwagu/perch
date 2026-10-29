import { describe, expect, it } from 'vitest'

import { stepPlan } from './step-plan'

describe('stepPlan', () => {
  it('adds devices step by step and refuses a list that does not grow', () => {
    expect(stepPlan([100, 500, 1000])).toEqual([
      { total: 100, add: 100 },
      { total: 500, add: 400 },
      { total: 1000, add: 500 },
    ])
    expect(() => stepPlan([500, 100])).toThrow('devices must grow')
    expect(() => stepPlan([])).toThrow('devices must grow')
  })
})
