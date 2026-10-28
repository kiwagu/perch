import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { memoryStorage } from './key-value'
import { forgetDevice, saveDevice, savedIdentity, savedKeys, saveKeys } from './signed-in'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
  memberships: [] as readonly Membership[],
}

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
