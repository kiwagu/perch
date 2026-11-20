import { describe, expect, it } from 'vitest'

import { checkProfileBio } from './profile-bio.rule'

describe('checkProfileBio', () => {
  it('keeps a bio of up to 2000 characters as it is, an empty one included, and refuses a longer one', () => {
    expect(checkProfileBio('')._unsafeUnwrap()).toBe('')
    expect(checkProfileBio('  Hi  ')._unsafeUnwrap()).toBe('  Hi  ')
    expect(checkProfileBio('x'.repeat(2000))._unsafeUnwrap()).toHaveLength(2000)
    expect(checkProfileBio('x'.repeat(2001))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:BIO_TOO_LONG' },
    ])
  })

  it('counts a character outside the basic plane once, as the database does', () => {
    expect(checkProfileBio('\u{1F600}'.repeat(2000)).isOk()).toBe(true)
    expect(checkProfileBio('\u{1F600}'.repeat(2001))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:BIO_TOO_LONG' },
    ])
  })
})
