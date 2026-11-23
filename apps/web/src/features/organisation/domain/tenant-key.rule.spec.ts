import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { checkTenantKey } from './tenant-key.rule'

/** The most characters a key has, as the contract says it. */
const { maxLength: KEY_MAX } = CONTRACT_VALUES['organisation-key']

describe('checkTenantKey', () => {
  it('keeps a key of lowercase letters, digits and underscores, trimmed', () => {
    expect(checkTenantKey('acme')._unsafeUnwrap()).toBe('acme')
    expect(checkTenantKey(' acme_2026 ')._unsafeUnwrap()).toBe('acme_2026')
  })

  it('refuses a key outside the rule', () => {
    for (const key of ['', 'a', '1acme', 'Acme', 'acme-corp', 'a'.repeat(KEY_MAX + 1)]) {
      expect(checkTenantKey(key)._unsafeUnwrapErr()).toEqual([{ code: 'organisation:KEY_INVALID' }])
    }
  })
})
