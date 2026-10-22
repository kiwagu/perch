import { describe, expect, it } from 'vitest'

import { anchorDefSchema } from './anchor'

const button = (binding: unknown) => ({ kind: 'button', binding })

const action = (params: Record<string, unknown>) => ({ action: 'thing.updateThing', params })

describe('anchorDefSchema binding', () => {
  it('accepts a single binding', () => {
    expect(anchorDefSchema.safeParse(button({ model: 'thing.title' })).success).toBe(true)
  })
  it('accepts several bindings, run in order or chosen by the mode', () => {
    const parsed = anchorDefSchema.safeParse(
      button([
        { action: 'profile.updateName', params: { name: 'user.profile.name-input' } },
        { action: 'profile.updateBio', params: { bio: 'user.profile.bio-textarea' } },
      ]),
    )

    expect(parsed.success).toBe(true)
  })
  it('refuses an empty list of bindings', () => {
    expect(anchorDefSchema.safeParse(button([])).success).toBe(false)
  })
})

describe('action params', () => {
  it('accepts an anchor or a constant value', () => {
    for (const value of [true, 3, 'all']) {
      expect(anchorDefSchema.safeParse(button(action({ forgetUnsent: { value } }))).success).toBe(
        true,
      )
    }

    expect(anchorDefSchema.safeParse(button(action({ title: 'sample.title-input' }))).success).toBe(
      true,
    )
  })
  it('refuses a constant that is not a primitive, and any other object', () => {
    expect(anchorDefSchema.safeParse(button(action({ flag: { value: {} } }))).success).toBe(false)
    expect(anchorDefSchema.safeParse(button(action({ flag: { other: 1 } }))).success).toBe(false)
  })
})
