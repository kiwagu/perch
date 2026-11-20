import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { profileNameOf } from './profile-name'

/** The most characters a profile's name has, as the contract says it. */
const { maxLength: MAX } = CONTRACT_VALUES['profile.name']

describe('profileNameOf', () => {
  it('answers the name trimmed', () => {
    expect(profileNameOf('  Ann Lee ')._unsafeUnwrap()).toBe('Ann Lee')
  })

  it.each(['', ' ', ' \t\n '])('refuses a name with nothing left once trimmed, %j', (name) => {
    expect(profileNameOf(name)._unsafeUnwrapErr()).toBe('name-required')
  })

  it('takes a name of the limit once trimmed and refuses one past it', () => {
    expect(profileNameOf(` ${'r'.repeat(MAX)} `).isOk()).toBe(true)
    expect(profileNameOf(` ${'r'.repeat(MAX + 1)} `)._unsafeUnwrapErr()).toBe('name-too-long')
  })

  it('counts a character outside the basic plane once, as the directory does', () => {
    expect(profileNameOf('\u{1F600}'.repeat(MAX)).isOk()).toBe(true)
    expect(profileNameOf('\u{1F600}'.repeat(MAX + 1)).isErr()).toBe(true)
  })
})
