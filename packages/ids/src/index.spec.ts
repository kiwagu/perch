import { resetValidationMode, setValidationMode } from 'entity-id'
import { afterEach, describe, expect, it } from 'vitest'

import {
  type IdentityId,
  identityIdFactory,
  idSchemas,
  type ProfileId,
  profileIdFactory,
  registry,
} from './index'

afterEach(() => resetValidationMode())

describe('the entity id registry', () => {
  it('mints prefixed ids per kind', () => {
    const id: ProfileId = profileIdFactory.create()

    expect(id.startsWith('prf_')).toBe(true)
    expect(identityIdFactory.create().startsWith('idn_')).toBe(true)
  })

  it('tells kinds apart', () => {
    const identity: IdentityId = identityIdFactory.create()

    expect(profileIdFactory.is(identity)).toBe(false)
    expect(registry.kindOf(profileIdFactory.create())).toBe('profile')
    expect(registry.kindOf(identity)).toBe('identity')
  })

  it('does not take an id of the retired user prefix for an identity', () => {
    expect(identityIdFactory.is('usr_0000000000000000.01m52pexcp')).toBe(false)
  })

  it('validates ids at full depth once the full mode is set', () => {
    setValidationMode('full')

    expect(idSchemas.profile.schema.safeParse(profileIdFactory.create()).success).toBe(true)
    expect(idSchemas.profile.schema.safeParse('prf_not-an-id').success).toBe(false)
    expect(idSchemas.profile.schema.safeParse(identityIdFactory.create()).success).toBe(false)
  })
})
