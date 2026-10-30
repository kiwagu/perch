import { describe, expect, it } from 'vitest'

import { validationKey, z } from './browser'

describe('the shared zod instance in a browser', () => {
  it('compiles no parser from a string, for any schema defined with it', () => {
    expect(z.config().jitless).toBe(true)
  })

  it('keeps the error map of the shared instance', () => {
    const result = z.object({ name: z.string().min(1) }).safeParse({ name: '' })

    expect(result.error?.issues[0]?.message).toBe(validationKey('too_small'))
  })
})
