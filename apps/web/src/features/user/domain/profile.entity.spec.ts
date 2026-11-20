import { describe, expect, it } from 'vitest'

import { identityIdFactory, profileIdFactory } from '@workspace/ids'

import { ProfileSchema } from './profile.entity'

const valid = {
  id: profileIdFactory.create(),
  identity: identityIdFactory.create(),
  name: 'Ann',
  email: 'ann@example.test',
  createdAt: new Date('2026-01-01T00:00:00Z'),
}

describe('ProfileSchema', () => {
  it('accepts a complete profile with an optional bio', () => {
    expect(ProfileSchema.safeParse(valid).success).toBe(true)
    expect(ProfileSchema.safeParse({ ...valid, bio: 'Hi' }).success).toBe(true)
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

  it('counts a character outside the basic plane once in a name and a bio', () => {
    const emoji = '\u{1F600}'

    expect(ProfileSchema.safeParse({ ...valid, name: emoji.repeat(80) }).success).toBe(true)
    expect(ProfileSchema.safeParse({ ...valid, name: emoji.repeat(81) }).success).toBe(false)
    expect(ProfileSchema.safeParse({ ...valid, bio: emoji.repeat(2000) }).success).toBe(true)
    expect(ProfileSchema.safeParse({ ...valid, bio: emoji.repeat(2001) }).success).toBe(false)
  })
})
