import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { memoryStorage } from './key-value'
import {
  addLeftoverIdentity,
  dropLeftoverIdentity,
  LEFTOVER_IDENTITIES_KEY,
  leftoverIdentities,
} from './leftover-identities'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

describe('leftover identities', () => {
  it('keeps each identity whose databases are still to delete once, oldest first', () => {
    const storage = memoryStorage()

    addLeftoverIdentity(storage, ann)
    addLeftoverIdentity(storage, bob)
    addLeftoverIdentity(storage, ann)

    expect(leftoverIdentities(storage)).toEqual([ann, bob])
  })

  it('drops one identity and keeps no empty list', () => {
    const storage = memoryStorage()

    addLeftoverIdentity(storage, ann)
    addLeftoverIdentity(storage, bob)
    dropLeftoverIdentity(storage, ann)

    expect(leftoverIdentities(storage)).toEqual([bob])

    dropLeftoverIdentity(storage, bob)

    expect(storage.get(LEFTOVER_IDENTITIES_KEY)).toBeUndefined()
  })

  it('reads a kept value that does not list identities as none, and skips an entry that is not one', () => {
    const storage = memoryStorage()

    storage.set(LEFTOVER_IDENTITIES_KEY, '{not json')

    expect(leftoverIdentities(storage)).toEqual([])

    storage.set(LEFTOVER_IDENTITIES_KEY, JSON.stringify([ann, 'app-identity', 7]))

    expect(leftoverIdentities(storage)).toEqual([ann])
  })
})
