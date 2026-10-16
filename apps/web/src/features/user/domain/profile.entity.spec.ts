import { describe, expect, it } from 'vitest'

import { profileIdFactory, userIdFactory } from '@workspace/ids'

import { checkProfileName, ProfileSchema } from './profile.entity'

const valid = {
  id: profileIdFactory.create(),
  user: userIdFactory.create(),
  name: 'Ann',
  email: 'ann@example.test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

describe('ProfileSchema', () => {
  it('accepts a complete profile with optional bio and language', () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true)
    expect(ProfileSchema.safeParse({ ...valid, bio: 'Hi', locale: 'es' }).success).toBe(true)
  })

  it('rejects an empty name, a bad email and an id of another kind', () => {
    expect(ProfileSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
    expect(ProfileSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
    expect(ProfileSchema.safeParse({ ...valid, id: userIdFactory.create() }).success).toBe(false)
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
