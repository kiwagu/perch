import { describe, expect, it } from 'vitest'

import { MAX_PROFILE_NAME, profileNameOf } from './profile-name'

describe('profileNameOf', () => {
  it('answers the name trimmed', () => {
    expect(profileNameOf('  Ann Lee ')._unsafeUnwrap()).toBe('Ann Lee')
  })

  it.each(['', ' ', ' \t\n '])('refuses a name with nothing left once trimmed, %j', (name) => {
    expect(profileNameOf(name)._unsafeUnwrapErr()).toBe('name-required')
  })

  it('takes 80 characters once trimmed and refuses 81', () => {
    expect(profileNameOf(` ${'r'.repeat(MAX_PROFILE_NAME)} `).isOk()).toBe(true)
    expect(profileNameOf(` ${'r'.repeat(MAX_PROFILE_NAME + 1)} `)._unsafeUnwrapErr()).toBe(
      'name-too-long',
    )
  })

  it('counts a character outside the basic plane once, as the directory does', () => {
    expect(profileNameOf('\u{1F600}'.repeat(MAX_PROFILE_NAME)).isOk()).toBe(true)
    expect(profileNameOf('\u{1F600}'.repeat(MAX_PROFILE_NAME + 1)).isErr()).toBe(true)
  })
})
