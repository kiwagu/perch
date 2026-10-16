import { resetValidationMode, setValidationMode } from 'entity-id'
import { afterEach, describe, expect, it } from 'vitest'

import {
  idSchemas,
  type ProfileId,
  profileIdFactory,
  registry,
  type UserId,
  userIdFactory,
} from './index'

afterEach(() => resetValidationMode())

describe('the entity id registry', () => {
  it('mints prefixed ids per kind', () => {
    const id: ProfileId = profileIdFactory.create()

    expect(id.startsWith('prf_')).toBe(true)
    expect(userIdFactory.create().startsWith('usr_')).toBe(true)
  })

  it('tells kinds apart', () => {
    const user: UserId = userIdFactory.create()

    expect(profileIdFactory.is(user)).toBe(false)
    expect(registry.kindOf(profileIdFactory.create())).toBe('profile')
    expect(registry.kindOf(user)).toBe('user')
  })

  it('validates ids at full depth once the full mode is set', () => {
    setValidationMode('full')

    expect(idSchemas.profile.schema.safeParse(profileIdFactory.create()).success).toBe(true)
    expect(idSchemas.profile.schema.safeParse('prf_not-an-id').success).toBe(false)
    expect(idSchemas.profile.schema.safeParse(userIdFactory.create()).success).toBe(false)
  })
})
