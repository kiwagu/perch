import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { checkProfileName } from './profile-name.rule'

/** The most characters a display name has, as the contract says it. */
const { maxLength: MAX } = CONTRACT_VALUES['profile.name']

describe('checkProfileName', () => {
  it('trims a name and refuses one that is blank or too long', () => {
    expect(checkProfileName('  Ann  ')._unsafeUnwrap()).toBe('Ann')
    expect(checkProfileName('   ')._unsafeUnwrapErr()).toEqual([{ code: 'profile:NAME_REQUIRED' }])
    expect(checkProfileName('x'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:NAME_TOO_LONG' },
    ])
  })

  it('counts a character outside the basic plane once, as the gateway and the database do', () => {
    expect(checkProfileName('\u{1F600}'.repeat(MAX)).isOk()).toBe(true)
    expect(checkProfileName('\u{1F600}'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:NAME_TOO_LONG' },
    ])
  })
})
