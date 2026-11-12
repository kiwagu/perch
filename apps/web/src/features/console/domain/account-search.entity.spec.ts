import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { ACCOUNT_SEARCH_MAX, AccountSearchSchema } from './account-search.entity'

describe('AccountSearchSchema', () => {
  it('reads the first page of 25 for an address that names neither', () => {
    expect(z.parse(AccountSearchSchema, {})).toEqual({ page: 1, size: 25 })
  })

  it('reads a search text, a page and one of the sizes as the address gives them', () => {
    expect(z.parse(AccountSearchSchema, { q: 'ann', page: 3, size: 10 })).toEqual({
      q: 'ann',
      page: 3,
      size: 10,
    })
    expect(z.parse(AccountSearchSchema, { size: 50 })).toEqual({ page: 1, size: 50 })
  })

  it('refuses a page below 1 or not whole, a size it does not take, and a text past the longest email', () => {
    for (const refused of [
      { page: 0 },
      { page: 1.5 },
      { size: 20 },
      { size: '25' },
      { q: 'a'.repeat(ACCOUNT_SEARCH_MAX + 1) },
    ]) {
      expect(z.safeParse(AccountSearchSchema, refused).success, JSON.stringify(refused)).toBe(false)
    }
  })
})
