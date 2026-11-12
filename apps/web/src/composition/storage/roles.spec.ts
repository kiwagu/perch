import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { memoryStorage } from './key-value'
import { MEMBERSHIPS_KEY } from './memberships'
import { dropRole, forgetRoles, isRolesKey, rolesKeyOf, savedRoles, saveRoles } from './roles'
import { forgetDevice, IDENTITY_KEY, saveDevice } from './signed-in'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

describe("the account's platform roles on the device", () => {
  it('keeps one record per identity, under a key of its own', () => {
    expect(rolesKeyOf(ann)).toBe(`perch.session.roles.${ann}`)
    expect(rolesKeyOf(bob)).not.toBe(rolesKeyOf(ann))
  })

  it('knows its keys from the session’s other keys', () => {
    expect(isRolesKey(rolesKeyOf(ann))).toBe(true)

    for (const key of [IDENTITY_KEY, MEMBERSHIPS_KEY, 'perch.session.token', 'perch.theme']) {
      expect(isRolesKey(key)).toBe(false)
    }
  })

  it('reads back the roles saved for the identity', () => {
    const storage = memoryStorage()

    saveRoles(storage, ann, ['operator'])

    expect(savedRoles(storage, ann)).toEqual(['operator'])

    saveRoles(storage, ann, [])

    expect(savedRoles(storage, ann)).toEqual([])
  })

  it('reads none for an identity without a record', () => {
    expect(savedRoles(memoryStorage(), ann)).toEqual([])
  })

  it("never writes one identity's roles into another's record", () => {
    const storage = memoryStorage()

    saveRoles(storage, ann, ['operator'])
    saveRoles(storage, bob, [])

    expect(savedRoles(storage, ann)).toEqual(['operator'])
    expect(savedRoles(storage, bob)).toEqual([])
  })

  it('reads none from a record that does not parse', () => {
    const storage = memoryStorage()

    for (const value of [
      'not json',
      '[]',
      '["operator"]',
      JSON.stringify({ identity: ann, roles: 'operator' }),
      JSON.stringify({ identity: ann, roles: ['root'] }),
    ]) {
      storage.set(rolesKeyOf(ann), value)

      expect(savedRoles(storage, ann)).toEqual([])
    }
  })

  it("reads none from another identity's record found under the identity's key", () => {
    const storage = memoryStorage()

    saveRoles(storage, bob, ['operator'])
    storage.set(rolesKeyOf(ann), storage.get(rolesKeyOf(bob)) ?? expect.unreachable('a record'))

    expect(savedRoles(storage, ann)).toEqual([])
  })

  it("drops a role from the identity's record alone", () => {
    const storage = memoryStorage()

    saveRoles(storage, ann, ['operator'])
    saveRoles(storage, bob, ['operator'])
    dropRole(storage, ann, 'operator')

    expect(storage.get(rolesKeyOf(ann))).toBeDefined()
    expect(savedRoles(storage, ann)).toEqual([])
    expect(savedRoles(storage, bob)).toEqual(['operator'])
  })

  it('creates no record when it drops a role of an identity without one', () => {
    const storage = memoryStorage()

    dropRole(storage, ann, 'operator')

    expect(storage.get(rolesKeyOf(ann))).toBeUndefined()
  })

  it('forgets the record of one identity, leaving the others', () => {
    const storage = memoryStorage()

    saveRoles(storage, ann, ['operator'])
    saveRoles(storage, bob, ['operator'])
    forgetRoles(storage, ann)

    expect(storage.get(rolesKeyOf(ann))).toBeUndefined()
    expect(savedRoles(storage, bob)).toEqual(['operator'])
  })

  it("forgetDevice removes the signed-out identity's record beside its memberships", () => {
    const storage = memoryStorage()

    saveDevice(storage, {
      identity: { id: ann, email: 'ann@example.test' },
      token: 't',
      memberships: [],
    })
    saveRoles(storage, ann, ['operator'])
    saveRoles(storage, bob, ['operator'])
    forgetDevice(storage)

    expect(storage.get(rolesKeyOf(ann))).toBeUndefined()
    expect(storage.get(MEMBERSHIPS_KEY)).toBeUndefined()
    // A record of another identity is no part of this sign-out.
    expect(savedRoles(storage, bob)).toEqual(['operator'])
  })
})
