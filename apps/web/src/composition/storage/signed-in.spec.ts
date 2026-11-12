import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { keptAccountStart } from './account-start'
import { memoryStorage } from './key-value'
import { savedMemberships, savedTenant, saveTenant } from './memberships'
import { forgetDevice, saveDevice, savedIdentity, savedToken, savedTokenOf } from './signed-in'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-1',
  memberships: [acme],
}

describe('the signed-in device', () => {
  it('keeps the identity, its session token and its memberships, and forgets them with the tenant', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    saveTenant(storage, 'acme')

    expect(savedIdentity(storage)).toEqual(ann.identity)
    expect(savedToken(storage)).toBe('token-1')
    expect(savedMemberships(storage, ann.identity.id)).toEqual([acme])

    forgetDevice(storage)

    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedToken(storage)).toBeUndefined()
    expect(storage.get('perch.session.token')).toBeUndefined()
    expect(savedMemberships(storage, ann.identity.id)).toEqual([])
    expect(savedTenant(storage)).toBeUndefined()
  })

  it('keeps the token with the identity it was issued to, and gives it for that identity alone', () => {
    const storage = memoryStorage()
    const bob = identityIdFactory.create()

    saveDevice(storage, ann)

    expect(JSON.parse(storage.get('perch.session.token') ?? 'null')).toEqual({
      identity: ann.identity.id,
      token: 'token-1',
    })
    expect(savedTokenOf(storage, ann.identity.id)).toBe('token-1')
    expect(savedTokenOf(storage, bob)).toBeUndefined()
  })

  it('reads no token from a value that does not name the identity it was issued to', () => {
    const storage = memoryStorage()

    // As an older build kept it: the token alone.
    storage.set('perch.session.token', 'token-1')

    expect(savedToken(storage)).toBeUndefined()
    expect(savedTokenOf(storage, ann.identity.id)).toBeUndefined()
  })

  it('forgets, with the device, the start of the account the browser kept to finish', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    keptAccountStart(storage).keep({ identity: ann.identity.id, name: 'Ann', locale: 'en' })
    forgetDevice(storage)

    expect(keptAccountStart(storage).kept()).toBeUndefined()
  })

  it('keeps one token and nothing else beside it: no second key is ever written', () => {
    const storage = memoryStorage()
    const written: string[] = []
    const watched = {
      ...storage,
      set: (key: string, value: string) => {
        written.push(key)
        storage.set(key, value)
      },
    }

    saveDevice(watched, ann)

    expect(written).not.toContain('perch.session.refresh')
    // The token first, naming the identity should a later write break; the identity last: a tab
    // that follows it finds the token and the memberships saved already.
    expect(written).toEqual([
      'perch.session.token',
      `perch.session.memberships.${ann.identity.id}`,
      'perch.session.identity',
    ])
  })

  it('forgets the refresh key an older build kept beside the token', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    storage.set('perch.session.refresh', 'refresh-1')

    forgetDevice(storage)

    expect(storage.get('perch.session.refresh')).toBeUndefined()
  })

  it('reads no identity from a value that does not describe one', () => {
    const storage = memoryStorage()

    for (const value of ['not json', '{"id":"prf_x","email":"a@example.test"}', '[]']) {
      storage.set('perch.session.identity', value)

      expect(savedIdentity(storage)).toBeUndefined()
    }
  })
})
