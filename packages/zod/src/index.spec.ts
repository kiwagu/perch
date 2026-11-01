import { describe, expect, it } from 'vitest'

import { validationKey, z } from './index'

describe('the shared zod instance', () => {
  it('reports issues as translation keys built from the issue code', () => {
    const result = z.object({ name: z.string().min(1) }).safeParse({ name: '' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('validation.too_small')
  })

  it('keeps a message written by the schema author', () => {
    const result = z.string().min(3, 'user.profile.name-too-short').safeParse('a')

    expect(result.error?.issues[0]?.message).toBe('user.profile.name-too-short')
  })

  it('derives the key for any issue code', () => {
    expect(validationKey('invalid_type')).toBe('validation.invalid_type')
  })

  it('keeps the parser Zod compiles for an object schema, outside a browser', () => {
    expect(z.config().jitless).toBeFalsy()
  })
})
