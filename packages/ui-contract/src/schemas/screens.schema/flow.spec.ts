import { describe, expect, it } from 'vitest'

import { flowSchema } from './flow'

describe('flowSchema', () => {
  it('accepts an event that says which parameters its path passes', () => {
    const parsed = flowSchema.safeParse({
      states: ['sign-in', 'sign-up'],
      initial: 'sign-in',
      events: [
        {
          on: 'user.sign-in.submit-button',
          action: 'platform.sign-up',
          from: 'sign-up',
          params: { name: 'user.sign-in.name-input', remember: { value: false } },
          outcomes: { success: { route: '/me', codes: ['welcome'] } },
        },
      ],
    })

    expect(parsed.success).toBe(true)
  })
  it('refuses an event parameter that is neither an anchor nor a constant', () => {
    const parsed = flowSchema.safeParse({
      states: ['a'],
      initial: 'a',
      events: [{ on: 'x.y-button', params: { name: 'Not An Anchor' }, outcomes: { success: {} } }],
    })

    expect(parsed.success).toBe(false)
  })
})
