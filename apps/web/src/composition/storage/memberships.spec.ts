import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { memoryStorage } from './key-value'
import {
  isMembershipsKey,
  membershipsKeyOf,
  savedMemberships,
  savedTenant,
  saveMemberships,
  saveTenant,
} from './memberships'
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
  it("keeps each identity's memberships under a key of its own, which the session's other keys are not", () => {
    const bob = identityIdFactory.create()

    expect(membershipsKeyOf(ann.identity.id)).toBe(`perch.session.memberships.${ann.identity.id}`)
    expect(membershipsKeyOf(bob)).not.toBe(membershipsKeyOf(ann.identity.id))
    expect(isMembershipsKey(membershipsKeyOf(bob))).toBe(true)

    for (const key of [
      'perch.session.identity',
      'perch.session.tenant',
      `perch.session.roles.${bob}`,
    ]) {
      expect(isMembershipsKey(key)).toBe(false)
    }
  })

  it("leaves another identity's memberships as they are", () => {
    const storage = memoryStorage()
    const bob = identityIdFactory.create()

    saveMemberships(storage, ann.identity.id, [acme])
    saveMemberships(storage, bob, [])

    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])
  })

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

    const bob = identityIdFactory.create()

    for (const value of [
      'not json',
      '[]',
      '{"identity":"x","memberships":1}',
      // A record under Ann's key that names another identity.
      JSON.stringify({ identity: bob, memberships: [acme] }),
    ]) {
      storage.set(membershipsKeyOf(ann.identity.id), value)

      expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    }
  })

  it('forgetDevice clears the memberships and the tenant', () => {
    const storage = memoryStorage()

    saveDevice(storage, { ...ann, memberships: [acme] })
    saveTenant(storage, 'acme')
    forgetDevice(storage)

    expect(storage.get(membershipsKeyOf(ann.identity.id))).toBeUndefined()
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
