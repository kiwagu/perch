import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { memoryStorage, saveDevice } from '../storage'

import { otherAccountSaved, otherIdentitySaved } from './one-account'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

describe('one account per browser', () => {
  it('sees no other account while nobody is signed in', () => {
    const storage = memoryStorage()

    expect(otherAccountSaved(storage, 'bob@example.test')).toBe(false)
    expect(otherIdentitySaved(storage, identityIdFactory.create())).toBe(false)
  })

  it('tells another account by its email, whatever its case and spaces', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    expect(otherAccountSaved(storage, 'bob@example.test')).toBe(true)
    expect(otherAccountSaved(storage, ' Ann@Example.TEST ')).toBe(false)
  })

  it('tells another identity by its id', () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    expect(otherIdentitySaved(storage, identityIdFactory.create())).toBe(true)
    expect(otherIdentitySaved(storage, ann.identity.id)).toBe(false)
  })
})
