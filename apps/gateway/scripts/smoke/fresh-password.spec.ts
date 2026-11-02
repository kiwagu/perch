import { describe, expect, it } from 'vitest'

import { keepsPasswordRules } from '@workspace/kernel'

import { freshPassword } from './fresh-password'

describe('the passwords the smoke and the load test sign up with', () => {
  it('keep the rules of a new password, each of their own', () => {
    const passwords = Array.from({ length: 100 }, freshPassword)

    expect(passwords.filter((password) => !keepsPasswordRules(password))).toEqual([])
    expect(new Set(passwords).size).toBe(100)
  })
})
