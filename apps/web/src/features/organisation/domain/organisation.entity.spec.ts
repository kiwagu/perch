import { describe, expect, it } from 'vitest'

import { checkOrganisationName, checkTenantKey, ORGANISATION_NAME_MAX } from './organisation.entity'

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

describe('checkOrganisationName', () => {
  it('trims a name and keeps one of up to 80 characters', () => {
    expect(ORGANISATION_NAME_MAX).toBe(80)
    expect(checkOrganisationName('  Acme  ')._unsafeUnwrap()).toBe('Acme')
    expect(checkOrganisationName('x'.repeat(80))._unsafeUnwrap()).toHaveLength(80)
  })

  it('refuses a name that is blank or longer than 80 characters', () => {
    expect(checkOrganisationName('   ')._unsafeUnwrapErr()).toEqual([
      { code: 'organisation:NAME_REQUIRED' },
    ])
    expect(checkOrganisationName('x'.repeat(81))._unsafeUnwrapErr()).toEqual([
      { code: 'organisation:NAME_TOO_LONG' },
    ])
  })
})
