import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { memoryStorage } from './key-value'
import { forgetDevice, saveDevice } from './signed-in'
import { savedTenantDatabases, saveTenantDatabases, TENANT_DATABASES_KEY } from './tenant-databases'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
  memberships: [] as readonly Membership[],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

describe('the tenant databases on this device', () => {
  const bob = identityIdFactory.create()

  it('keeps the keys of the identity they were saved for', () => {
    const storage = memoryStorage()

    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual([])

    saveTenantDatabases(storage, ann.identity.id, ['acme', 'globex'])

    expect(TENANT_DATABASES_KEY).toBe('perch.session.tenant-databases')
    expect(JSON.parse(storage.get(TENANT_DATABASES_KEY) ?? 'null')).toEqual({
      [ann.identity.id]: ['acme', 'globex'],
    })
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme', 'globex'])
  })

  it('reads none for another identity', () => {
    const storage = memoryStorage()

    saveTenantDatabases(storage, ann.identity.id, ['acme'])

    expect(savedTenantDatabases(storage, identityIdFactory.create())).toEqual([])
  })

  it("keeps each identity's keys apart: saving or clearing one leaves the others as they are", () => {
    const storage = memoryStorage()

    saveTenantDatabases(storage, ann.identity.id, ['acme'])
    saveTenantDatabases(storage, bob, ['globex'])

    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])
    expect(savedTenantDatabases(storage, bob)).toEqual(['globex'])

    saveTenantDatabases(storage, bob, ['globex', 'initech'])

    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])
    expect(savedTenantDatabases(storage, bob)).toEqual(['globex', 'initech'])

    saveTenantDatabases(storage, ann.identity.id, [])

    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual([])
    expect(JSON.parse(storage.get(TENANT_DATABASES_KEY) ?? 'null')).toEqual({
      [bob]: ['globex', 'initech'],
    })
  })

  it('reads none from a value that does not parse, and a save replaces it', () => {
    const storage = memoryStorage()

    const notAKey = JSON.stringify({ [ann.identity.id]: ['acme', '../other'] })
    const notAnIdentity = JSON.stringify({ [ann.identity.id]: ['acme'], x: ['globex'] })
    const oneIdentityOnly = JSON.stringify({ identity: ann.identity.id, keys: ['acme'] })

    for (const value of [
      'not json',
      '[]',
      'null',
      `{"${ann.identity.id}":1}`,
      notAKey,
      notAnIdentity,
      oneIdentityOnly,
    ]) {
      storage.set(TENANT_DATABASES_KEY, value)

      expect(savedTenantDatabases(storage, ann.identity.id)).toEqual([])
    }

    saveTenantDatabases(storage, bob, ['globex'])

    expect(JSON.parse(storage.get(TENANT_DATABASES_KEY) ?? 'null')).toEqual({ [bob]: ['globex'] })
  })

  it('keeps no empty inventory', () => {
    const storage = memoryStorage()

    saveTenantDatabases(storage, ann.identity.id, ['acme'])
    saveTenantDatabases(storage, bob, ['globex'])
    saveTenantDatabases(storage, ann.identity.id, [])
    saveTenantDatabases(storage, bob, [])

    expect(storage.get(TENANT_DATABASES_KEY)).toBeUndefined()

    saveTenantDatabases(storage, ann.identity.id, [])

    expect(storage.get(TENANT_DATABASES_KEY)).toBeUndefined()
  })

  it('outlives forgetDevice: databases kept for the next sign-in stay counted', () => {
    const storage = memoryStorage()

    saveDevice(storage, { ...ann, memberships: [acme] })
    saveTenantDatabases(storage, ann.identity.id, ['acme'])
    forgetDevice(storage)

    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])
  })
})
