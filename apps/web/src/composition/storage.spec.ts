import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import {
  browserStorage,
  deviceIdFrom,
  forgetDevice,
  forgetSigningOut,
  memoryStorage,
  saveDevice,
  savedIdentity,
  savedKeys,
  savedMemberships,
  savedTenant,
  savedTenantDatabases,
  saveKeys,
  saveMemberships,
  saveSigningOut,
  saveTenant,
  saveTenantDatabases,
  signingOutSince,
  TENANT_DATABASES_KEY,
} from './storage'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
  memberships: [] as readonly Membership[],
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

describe('deviceIdFrom', () => {
  it('names the device once and keeps the name', () => {
    const storage = memoryStorage()
    const first = deviceIdFrom(storage)

    expect(first).toMatch(/^[0-9a-f-]{36}$/)
    expect(deviceIdFrom(storage)).toBe(first)
    expect(deviceIdFrom(memoryStorage())).not.toBe(first)
  })
})

describe('the signed-in device', () => {
  it('keeps the identity and its keys, renews the keys and forgets all of them', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    expect(savedIdentity(storage)).toEqual(ann.identity)
    expect(savedKeys(storage)).toEqual(ann.tokens)

    saveKeys(storage, { access: 'access-2', refresh: 'refresh-2' })

    expect(savedKeys(storage)).toEqual({ access: 'access-2', refresh: 'refresh-2' })

    forgetDevice(storage)

    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedKeys(storage)).toBeUndefined()
    expect(storage.get('perch.session.token')).toBeUndefined()
  })

  it('reads no identity from a value that does not describe one', () => {
    const storage = memoryStorage()

    for (const value of ['not json', '{"id":"prf_x","email":"a@example.test"}', '[]']) {
      storage.set('perch.session.identity', value)

      expect(savedIdentity(storage)).toBeUndefined()
    }
  })
})

describe('a sign-out under way', () => {
  it('keeps when it began for every tab, until it is forgotten', () => {
    const storage = memoryStorage()

    expect(signingOutSince(storage)).toBeUndefined()

    saveSigningOut(storage, 1_700_000_000_000)

    expect(signingOutSince(storage)).toBe(1_700_000_000_000)

    forgetSigningOut(storage)

    expect(signingOutSince(storage)).toBeUndefined()
    expect(storage.get('perch.session.signing-out')).toBeUndefined()
  })

  it('reads no time from a value that is not one', () => {
    const storage = memoryStorage()

    storage.set('perch.session.signing-out', 'soon')

    expect(signingOutSince(storage)).toBeUndefined()
  })
})

/** A `window` that hands `storage` events to the listeners the storage adds. */
function fakeWindow() {
  const listeners = new Set<(event: StorageEvent) => void>()

  return {
    events: {
      addEventListener: (_type: 'storage', listener: (event: StorageEvent) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: 'storage', listener: (event: StorageEvent) => void) => {
        listeners.delete(listener)
      },
    },
    dispatch: (event: Pick<StorageEvent, 'key' | 'storageArea'>) => {
      for (const listener of listeners) {
        listener(event as StorageEvent)
      }
    },
  }
}

describe('changes made in other tabs', () => {
  it('hears the keys other tabs change in this storage, all of them when it is cleared', () => {
    const store = new Map<string, string>()
    const area = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    } as unknown as Storage
    const window = fakeWindow()
    const storage = browserStorage(area, window.events)
    const heard: Array<string | undefined> = []
    const stop = storage.onChangeElsewhere((key) => heard.push(key))

    window.dispatch({ key: 'perch.session.identity', storageArea: area })
    window.dispatch({ key: null, storageArea: area })
    window.dispatch({ key: 'perch.session.identity', storageArea: null })
    stop()
    window.dispatch({ key: 'perch.session.token', storageArea: area })

    expect(heard).toEqual(['perch.session.identity', undefined])
  })

  it('lets a test change the memory storage as another tab would', () => {
    const storage = memoryStorage()
    const heard: Array<string | undefined> = []

    storage.onChangeElsewhere((key) => heard.push(key))
    storage.set('own', 'a')
    storage.changeElsewhere('theirs', 'b')
    storage.changeElsewhere('own', undefined)

    expect(heard).toEqual(['theirs', 'own'])
    expect(storage.get('theirs')).toBe('b')
    expect(storage.get('own')).toBeUndefined()
  })
})

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

describe('the tenant databases on this device', () => {
  it('keeps the keys of the identity they were saved for', () => {
    const storage = memoryStorage()

    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual([])

    saveTenantDatabases(storage, ann.identity.id, ['acme', 'globex'])

    expect(TENANT_DATABASES_KEY).toBe('perch.session.tenant-databases')
    expect(JSON.parse(storage.get(TENANT_DATABASES_KEY) ?? 'null')).toEqual({
      identity: ann.identity.id,
      keys: ['acme', 'globex'],
    })
    expect(savedTenantDatabases(storage, ann.identity.id)).toEqual(['acme', 'globex'])
  })

  it('reads none for another identity', () => {
    const storage = memoryStorage()

    saveTenantDatabases(storage, ann.identity.id, ['acme'])

    expect(savedTenantDatabases(storage, identityIdFactory.create())).toEqual([])
  })

  it('reads none from a value that does not parse', () => {
    const storage = memoryStorage()

    const notAKey = JSON.stringify({ identity: ann.identity.id, keys: ['acme', '../other'] })

    for (const value of [
      'not json',
      '[]',
      '{"identity":"x","keys":["acme"]}',
      '{"keys":1}',
      notAKey,
    ]) {
      storage.set(TENANT_DATABASES_KEY, value)

      expect(savedTenantDatabases(storage, ann.identity.id)).toEqual([])
    }
  })

  it('keeps no empty inventory', () => {
    const storage = memoryStorage()

    saveTenantDatabases(storage, ann.identity.id, ['acme'])
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
