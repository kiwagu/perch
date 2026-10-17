import { describe, expect, it } from 'vitest'

import { identityIdFactory, profileIdFactory } from '@workspace/ids'

import { checkProfileBio, checkProfileName, ProfileSchema } from './profile.entity'

const valid = {
  id: profileIdFactory.create(),
  identity: identityIdFactory.create(),
  name: 'Ann',
  email: 'ann@example.test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

describe('ProfileSchema', () => {
  it('accepts a complete profile with optional bio and language', () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true)
    expect(ProfileSchema.safeParse({ ...valid, bio: 'Hi', locale: 'es' }).success).toBe(true)
  })

  it('rejects a bio longer than 2000 characters', () => {
    expect(ProfileSchema.safeParse({ ...valid, bio: 'x'.repeat(2000) }).success).toBe(true)
    expect(ProfileSchema.safeParse({ ...valid, bio: 'x'.repeat(2001) }).success).toBe(false)
  })

  it('rejects an empty name, a bad email and an id of another kind', () => {
    expect(ProfileSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    expect(ProfileSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
    expect(ProfileSchema.safeParse({ ...valid, id: identityIdFactory.create() }).success).toBe(
      false,
    )
  })
})

describe('checkProfileName', () => {
  it('trims a name and refuses one that is blank or too long', () => {
    expect(checkProfileName('  Ann  ')._unsafeUnwrap()).toBe('Ann')
    expect(checkProfileName('   ')._unsafeUnwrapErr()).toEqual([{ code: 'profile:NAME_REQUIRED' }])
    expect(checkProfileName('x'.repeat(81))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:NAME_TOO_LONG' },
    ])
  })
})

describe('checkProfileBio', () => {
  it('keeps a bio of up to 2000 characters as it is, an empty one included, and refuses a longer one', () => {
    expect(checkProfileBio('')._unsafeUnwrap()).toBe('')
    expect(checkProfileBio('  Hi  ')._unsafeUnwrap()).toBe('  Hi  ')
    expect(checkProfileBio('x'.repeat(2000))._unsafeUnwrap()).toHaveLength(2000)
    expect(checkProfileBio('x'.repeat(2001))._unsafeUnwrapErr()).toEqual([
      { code: 'profile:BIO_TOO_LONG' },
    ])
  })
})
