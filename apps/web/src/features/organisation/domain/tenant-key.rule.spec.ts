import { describe, expect, it } from 'vitest'

import { checkTenantKey } from './tenant-key.rule'

describe('checkTenantKey', () => {
  it('keeps a key of 2 to 32 lowercase letters, digits and underscores, trimmed', () => {
    expect(checkTenantKey('acme')._unsafeUnwrap()).toBe('acme')
    expect(checkTenantKey(' acme_2026 ')._unsafeUnwrap()).toBe('acme_2026')
  })

  it('refuses a key outside the rule', () => {
    for (const key of ['', 'a', '1acme', 'Acme', 'acme-corp', 'a'.repeat(33)]) {
      expect(checkTenantKey(key)._unsafeUnwrapErr()).toEqual([{ code: 'organisation:KEY_INVALID' }])
    }
  })
})
