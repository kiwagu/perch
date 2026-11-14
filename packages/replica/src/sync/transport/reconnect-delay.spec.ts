import { describe, expect, it } from 'vitest'

import {
  NETWORK_BACK_DELAY_MS,
  networkBackDelay,
  RECONNECT_STEPS_MS,
  reconnectDelay,
} from './reconnect-delay'

const ATTEMPTS = [0, 1, 2, 3, 4, 5, 6]

describe('reconnectDelay', () => {
  it('is 0 for every attempt when the draw is 0', () => {
    expect(ATTEMPTS.map((attempt) => reconnectDelay(attempt, () => 0))).toEqual([
      0, 0, 0, 0, 0, 0, 0,
    ])
  })

  it('is half the step of the attempt when the draw is 0.5, the last step repeating', () => {
    expect(ATTEMPTS.map((attempt) => reconnectDelay(attempt, () => 0.5))).toEqual([
      500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000,
    ])
  })

  it('stays one millisecond under the step for the highest draw, never the step itself', () => {
    expect(ATTEMPTS.map((attempt) => reconnectDelay(attempt, () => 0.9999999))).toEqual([
      999, 1_999, 3_999, 7_999, 15_999, 29_999, 29_999,
    ])
  })

  it('keeps the last step for any later attempt', () => {
    expect(reconnectDelay(50, () => 0.5)).toBe(15_000)
  })

  it('has the six steps of the schedule', () => {
    expect(RECONNECT_STEPS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000])
  })
})

describe('networkBackDelay', () => {
  it('is 0, 500 and 999 ms for the draws 0, 0.5 and 0.9999999', () => {
    expect([0, 0.5, 0.9999999].map((draw) => networkBackDelay(() => draw))).toEqual([0, 500, 999])
  })

  it('is drawn from 0 up to a second', () => {
    expect(NETWORK_BACK_DELAY_MS).toBe(1_000)
  })
})
