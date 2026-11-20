import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { checkOrganisationName } from './organisation-name.rule'

/** The most characters an organisation name has, as the contract says it. */
const { maxLength: MAX } = CONTRACT_VALUES['organisation-name']

describe('checkOrganisationName', () => {
  it('trims a name and keeps one up to the limit', () => {
    expect(checkOrganisationName('  Acme  ')._unsafeUnwrap()).toBe('Acme')
    expect(checkOrganisationName('x'.repeat(MAX))._unsafeUnwrap()).toHaveLength(MAX)
  })

  it('refuses a name that is blank or longer than the limit', () => {
    expect(checkOrganisationName('   ')._unsafeUnwrapErr()).toEqual([
      { code: 'organisation:NAME_REQUIRED' },
    ])
    expect(checkOrganisationName('x'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'organisation:NAME_TOO_LONG' },
    ])
  })

  it('counts a character outside the basic plane once, as the gateway does', () => {
    expect(checkOrganisationName('\u{1F600}'.repeat(MAX)).isOk()).toBe(true)
    expect(checkOrganisationName('\u{1F600}'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'organisation:NAME_TOO_LONG' },
    ])
  })
})
