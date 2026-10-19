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
