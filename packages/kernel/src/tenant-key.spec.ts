import { describe, expect, it } from 'vitest'

import { isTenantKey, TENANT_KEY_PATTERN } from './tenant-key'

describe('tenant keys', () => {
  it('accepts lowercase letters, digits and underscores, 2 to 32 characters, starting with a letter', () => {
    expect(isTenantKey('acme')).toBe(true)
    expect(isTenantKey('acme_2026')).toBe(true)
    expect(isTenantKey('a'.repeat(32))).toBe(true)
    expect(isTenantKey('a')).toBe(false)
    expect(isTenantKey('1acme')).toBe(false)
    expect(isTenantKey('Acme')).toBe(false)
    expect(isTenantKey('acme-corp')).toBe(false)
    expect(isTenantKey('a'.repeat(33))).toBe(false)
  })

  it('is the whole-string pattern the key rule tests', () => {
    expect(TENANT_KEY_PATTERN.test('acme')).toBe(true)
    expect(TENANT_KEY_PATTERN.test(' acme')).toBe(false)
    expect(TENANT_KEY_PATTERN.test('acme\n')).toBe(false)
  })
})
