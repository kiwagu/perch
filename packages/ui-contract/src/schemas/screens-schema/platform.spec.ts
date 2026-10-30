import { describe, expect, it } from 'vitest'

import { platformSchema } from './platform'

const PLATFORM = {
  actions: {},
  reserved: ['app-shell.status'],
  status: { anchor: 'app-shell.status', states: ['opening', 'ready'] },
}

describe('platformSchema events', () => {
  it('accepts no events, and events by name with their meaning', () => {
    expect(platformSchema.safeParse(PLATFORM).success).toBe(true)
    expect(
      platformSchema.safeParse({ ...PLATFORM, events: { opened: 'the local data is open' } })
        .success,
    ).toBe(true)
  })
  it('refuses an event whose name is not one kebab-case word group', () => {
    for (const name of ['Opened', 'data.opened', 'platform.opened']) {
      expect(
        platformSchema.safeParse({ ...PLATFORM, events: { [name]: 'the local data is open' } })
          .success,
        name,
      ).toBe(false)
    }
  })
})
