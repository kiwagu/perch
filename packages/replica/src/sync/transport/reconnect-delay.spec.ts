import { describe, expect, it } from 'vitest'

import { RECONNECT_DELAYS_MS, reconnectDelay } from './reconnect-delay'

describe('reconnectDelay', () => {
  it('gives each reconnect in a row its step, the last step repeating', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ])
  })

  it('keeps the last step for any later attempt', () => {
    expect(reconnectDelay(50)).toBe(30_000)
  })

  it('has the six steps of the schedule', () => {
    expect(RECONNECT_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000])
  })
})
