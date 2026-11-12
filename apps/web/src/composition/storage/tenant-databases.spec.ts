import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { signedIn, signedOut } from '../__fixtures__/signed-in'

import { memoryStorage } from './key-value'
import { savedSession } from './signed-in'
import { savedTenantDatabases, saveTenantDatabases, TENANT_DATABASES_KEY } from './tenant-databases'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-1',
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

  it('outlives the sign-out: databases kept for the next sign-in stay counted', () => {
    const storage = memoryStorage()

    signedIn(storage, ann)
    saveTenantDatabases(storage, ann.identity.id, ['acme'])
    signedOut(storage)

    expect(savedSession(storage)).toBeUndefined()
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme'])
  })
})
