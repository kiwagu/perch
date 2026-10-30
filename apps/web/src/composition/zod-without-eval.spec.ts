import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import './zod-without-eval'

describe('zod-without-eval', () => {
  it('turns off the parser Zod would compile from a string, for every schema defined after it', () => {
    expect(z.config().jitless).toBe(true)
  })
})
