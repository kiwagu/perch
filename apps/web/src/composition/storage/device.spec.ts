import { describe, expect, it } from 'vitest'

import { deviceIdFrom } from './device'
import { memoryStorage } from './key-value'

describe('deviceIdFrom', () => {
  it('names the device once and keeps the name', () => {
    const storage = memoryStorage()
    const first = deviceIdFrom(storage)

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(deviceIdFrom(storage)).toBe(first)
    expect(deviceIdFrom(memoryStorage())).not.toBe(first)
  })

  it('names the device again when the stored name is not a device id', () => {
    for (const stored of ['d'.repeat(65), '']) {
      const storage = memoryStorage()

      storage.set('perch.device.id', stored)

      const minted = deviceIdFrom(storage)

      expect(minted).toMatch(/^[0-9a-f-]{36}$/)
      expect(storage.get('perch.device.id')).toBe(minted)
      expect(deviceIdFrom(storage)).toBe(minted)
    }
  })
})
