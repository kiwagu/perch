import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { memoryStorage } from './key-value'
import { savedMemberships, savedTenant, saveMemberships, saveTenant } from './memberships'
import { forgetDevice, saveDevice } from './signed-in'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-1',
  memberships: [] as readonly Membership[],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

describe('memberships and the current tenant', () => {
  it('keeps the memberships of the identity they were saved for', () => {
    const storage = memoryStorage()

    saveMemberships(storage, ann.identity.id, [acme])

    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
  })

  it('saves the memberships with the device', () => {
    const storage = memoryStorage()

    saveDevice(storage, { ...ann, memberships: [acme] })

    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
  })

  it('reads none for another identity', () => {
    const storage = memoryStorage()

    saveMemberships(storage, ann.identity.id, [acme])

    expect(savedMemberships(storage, identityIdFactory.create())).toEqual([])
  })

  it('reads none from a value that does not parse', () => {
    const storage = memoryStorage()

    for (const value of ['not json', '[]', '{"identity":"x","memberships":1}']) {
      storage.set('perch.session.memberships', value)

      expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    }
  })

  it('forgetDevice clears the memberships and the tenant', () => {
    const storage = memoryStorage()

    saveDevice(storage, { ...ann, memberships: [acme] })
    saveTenant(storage, 'acme')
    forgetDevice(storage)

    expect(storage.get('perch.session.memberships')).toBeUndefined()
    expect(savedTenant(storage)).toBeUndefined()
  })

  it('keeps the current tenant key as plain text', () => {
    const storage = memoryStorage()

    expect(savedTenant(storage)).toBeUndefined()

    saveTenant(storage, 'acme')

    expect(storage.get('perch.session.tenant')).toBe('acme')
    expect(savedTenant(storage)).toBe('acme')
  })
})
