import { describe, expect, it, vi } from 'vitest'

import type * as Generated from './contract-values.gen'
import { CONTRACT_VALUES } from './contract-values.gen'
import { isTenantKey, TENANT_KEY_PATTERN } from './tenant-key'

// The generated length is one short of what the pattern itself allows, so only the length can
// refuse the longest key the pattern takes.
vi.mock('./contract-values.gen', async (importOriginal) => {
  const { CONTRACT_VALUES: values } = await importOriginal<typeof Generated>()
  const key = values['organisation-key']

  return {
    CONTRACT_VALUES: { ...values, 'organisation-key': { ...key, maxLength: key.maxLength - 1 } },
  }
})

const { maxLength: MAX, pattern } = CONTRACT_VALUES['organisation-key']

describe('a tenant key against the length the contract generates', () => {
  it('has a pattern that alone takes a key one longer than the length', () => {
    expect(new RegExp(pattern).test('a'.repeat(MAX + 1))).toBe(true)
  })

  it('takes the key of the length and refuses the one past it', () => {
    expect(isTenantKey('a'.repeat(MAX))).toBe(true)
    expect(isTenantKey('a'.repeat(MAX + 1))).toBe(false)
  })

  it('is the whole rule in the pattern a path is read with', () => {
    expect(TENANT_KEY_PATTERN.test('a'.repeat(MAX))).toBe(true)
    expect(TENANT_KEY_PATTERN.test('a'.repeat(MAX + 1))).toBe(false)
  })
})
