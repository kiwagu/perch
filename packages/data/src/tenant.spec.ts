import { describe, expect, it } from 'vitest'

import { isTenantKey, tenantDatabase, tenantRegionId } from './tenant'

describe('tenant keys', () => {
  it('accepts lowercase letters, digits and underscores, 2 to 32 characters, starting with a letter', () => {
    expect(isTenantKey('acme')).toBe(true)
    expect(isTenantKey('acme_2026')).toBe(true)
    expect(isTenantKey('a')).toBe(false)
    expect(isTenantKey('1acme')).toBe(false)
    expect(isTenantKey('Acme')).toBe(false)
    expect(isTenantKey('acme-corp')).toBe(false)
    expect(isTenantKey('a'.repeat(33))).toBe(false)
  })

  it('names the database and the region of a key', () => {
    expect(tenantDatabase('acme')).toBe('t_acme')
    expect(tenantRegionId('acme')).toBe('tenant:acme')
  })
})
