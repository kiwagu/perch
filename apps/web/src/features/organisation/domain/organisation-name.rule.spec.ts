import { describe, expect, it } from 'vitest'

import { ORGANISATION_NAME_MAX } from './organisation.entity'
import { checkOrganisationName } from './organisation-name.rule'

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
