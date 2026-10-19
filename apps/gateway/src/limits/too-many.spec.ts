import { describe, expect, it } from 'vitest'

import { tooMany } from './too-many'

describe('tooMany', () => {
  it('answers 429 with the code and the wait in whole seconds, rounded up', async () => {
    const response = tooMany({ retryAfterMs: 6_001 })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('7')
    expect(await response.json()).toEqual({ code: 'rate-limited' })
  })

  it('asks for at least one second', () => {
    expect(tooMany({ retryAfterMs: 10 }).headers.get('Retry-After')).toBe('1')
    expect(tooMany({ retryAfterMs: 0 }).headers.get('Retry-After')).toBe('1')
  })
})
