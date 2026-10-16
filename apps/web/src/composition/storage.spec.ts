import { describe, expect, it } from 'vitest'

import { deviceIdFrom, memoryStorage } from './storage'

describe('deviceIdFrom', () => {
  it('names the device once and keeps the name', () => {
    const storage = memoryStorage()
    const first = deviceIdFrom(storage)

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(deviceIdFrom(storage)).toBe(first)
    expect(deviceIdFrom(memoryStorage())).not.toBe(first)
  })
})
