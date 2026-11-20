import { describe, expect, it } from 'vitest'

import { CONTRACT_VALUES } from '@workspace/kernel'

import { checkProfileBio } from './profile-bio.rule'

/** The most characters a bio has, as the contract says it. */
const { maxLength: MAX } = CONTRACT_VALUES['profile.bio']

describe('checkProfileBio', () => {
  it('keeps a bio up to the limit as it is, an empty one included, and refuses a longer one', () => {
    expect(checkProfileBio('')._unsafeUnwrap()).toBe('')
    expect(checkProfileBio('  Hi  ')._unsafeUnwrap()).toBe('  Hi  ')
    expect(checkProfileBio('x'.repeat(MAX))._unsafeUnwrap()).toHaveLength(MAX)
    expect(checkProfileBio('x'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:BIO_TOO_LONG' },
    ])
  })

  it('counts a character outside the basic plane once, as the database does', () => {
    expect(checkProfileBio('\u{1F600}'.repeat(MAX)).isOk()).toBe(true)
    expect(checkProfileBio('\u{1F600}'.repeat(MAX + 1))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:BIO_TOO_LONG' },
    ])
  })
})
