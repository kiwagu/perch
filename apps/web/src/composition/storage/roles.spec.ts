import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { signedIn } from '../__fixtures__/signed-in'

import { memoryStorage } from './key-value'
import { membershipsKeyOf } from './memberships'
import { dropRole, forgetRoles, isRolesKey, rolesKeyOf, savedRoles, saveRoles } from './roles'
import { CURRENT_KEY, newSignInId } from './sign-in'
import { forgetSignIn, signedInKeyOf } from './signed-in'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

/** Ann's sign-in, another sign-in of hers, and Bob's: three records, each under its own key. */
function owners() {
  return {
    annFirst: { signIn: newSignInId(), identity: ann },
    annAgain: { signIn: newSignInId(), identity: ann },
    bobs: { signIn: newSignInId(), identity: bob },
  }
}

describe("the account's platform roles on the device", () => {
  it('keeps one record per sign-in, under a key of its own', () => {
    const signIn = newSignInId()

    expect(rolesKeyOf(signIn)).toBe(`perch.session.roles.${signIn}`)
    expect(rolesKeyOf(newSignInId())).not.toBe(rolesKeyOf(signIn))
  })

  it('knows its keys from the session’s other keys', () => {
    const signIn = newSignInId()

    expect(isRolesKey(rolesKeyOf(signIn))).toBe(true)

    for (const key of [
      CURRENT_KEY,
      signedInKeyOf(signIn),
      membershipsKeyOf(signIn),
      `perch.session.tenant.${signIn}`,
      'perch.theme',
    ]) {
      expect(isRolesKey(key)).toBe(false)
    }
  })

  it('reads back the roles saved for the sign-in, in a record naming its identity', () => {
    const storage = memoryStorage()
    const { annFirst } = owners()

    saveRoles(storage, annFirst, ['operator'])

    expect(savedRoles(storage, annFirst)).toEqual(['operator'])
    expect(JSON.parse(storage.get(rolesKeyOf(annFirst.signIn)) ?? 'null')).toEqual({
      identity: ann,
      roles: ['operator'],
    })

    saveRoles(storage, annFirst, [])

    expect(savedRoles(storage, annFirst)).toEqual([])
  })

  it("reads none for a sign-in without a record, the same account's other sign-in too", () => {
    const storage = memoryStorage()
    const { annFirst, annAgain } = owners()

    expect(savedRoles(storage, annFirst)).toEqual([])

    saveRoles(storage, annFirst, ['operator'])

    expect(savedRoles(storage, annAgain)).toEqual([])
  })

  it("never writes one sign-in's roles into another's record: another account's, nor the same account's", () => {
    const storage = memoryStorage()
    const { annFirst, annAgain, bobs } = owners()

    saveRoles(storage, annFirst, ['operator'])
    saveRoles(storage, bobs, [])
    saveRoles(storage, annAgain, [])

    expect(savedRoles(storage, annFirst)).toEqual(['operator'])
    expect(savedRoles(storage, bobs)).toEqual([])
    expect(savedRoles(storage, annAgain)).toEqual([])
  })

  it('reads none from a record that does not parse', () => {
    const storage = memoryStorage()
    const { annFirst } = owners()

    for (const value of [
      'not json',
      '[]',
      '["operator"]',
      JSON.stringify({ identity: ann, roles: 'operator' }),
      JSON.stringify({ identity: ann, roles: ['root'] }),
    ]) {
      storage.set(rolesKeyOf(annFirst.signIn), value)

      expect(savedRoles(storage, annFirst)).toEqual([])
    }
  })

  it("reads none from another identity's record found under the sign-in's key", () => {
    const storage = memoryStorage()
    const { annFirst, bobs } = owners()

    saveRoles(storage, bobs, ['operator'])
    storage.set(
      rolesKeyOf(annFirst.signIn),
      storage.get(rolesKeyOf(bobs.signIn)) ?? expect.unreachable('a record'),
    )

    expect(savedRoles(storage, annFirst)).toEqual([])
    // Nor from Bob's own record, read as Ann's.
    expect(savedRoles(storage, { signIn: bobs.signIn, identity: ann })).toEqual([])
  })

  it("drops a role from the sign-in's record alone", () => {
    const storage = memoryStorage()
    const { annFirst, annAgain, bobs } = owners()

    saveRoles(storage, annFirst, ['operator'])
    saveRoles(storage, annAgain, ['operator'])
    saveRoles(storage, bobs, ['operator'])
    dropRole(storage, annFirst, 'operator')

    expect(storage.get(rolesKeyOf(annFirst.signIn))).toBeDefined()
    expect(savedRoles(storage, annFirst)).toEqual([])
    expect(savedRoles(storage, annAgain)).toEqual(['operator'])
    expect(savedRoles(storage, bobs)).toEqual(['operator'])
  })

  it("leaves a sign-in's record as it is when the drop is asked for another identity", () => {
    const storage = memoryStorage()
    const { annFirst } = owners()

    saveRoles(storage, annFirst, ['operator'])
    dropRole(storage, { signIn: annFirst.signIn, identity: bob }, 'operator')

    expect(savedRoles(storage, annFirst)).toEqual(['operator'])
  })

  it('creates no record when it drops a role of a sign-in without one', () => {
    const storage = memoryStorage()
    const { annFirst } = owners()

    dropRole(storage, annFirst, 'operator')

    expect(storage.get(rolesKeyOf(annFirst.signIn))).toBeUndefined()
  })

  it('forgets the record of one sign-in, leaving the others', () => {
    const storage = memoryStorage()
    const { annFirst, annAgain, bobs } = owners()

    saveRoles(storage, annFirst, ['operator'])
    saveRoles(storage, annAgain, ['operator'])
    saveRoles(storage, bobs, ['operator'])
    forgetRoles(storage, annFirst.signIn)

    expect(storage.get(rolesKeyOf(annFirst.signIn))).toBeUndefined()
    expect(savedRoles(storage, annAgain)).toEqual(['operator'])
    expect(savedRoles(storage, bobs)).toEqual(['operator'])
  })

  it("forgetting a sign-in removes its record beside its memberships, and no other sign-in's", () => {
    const storage = memoryStorage()
    const { annAgain, bobs } = owners()
    const session = signedIn(storage, {
      identity: { id: ann, email: 'ann@example.test' },
      token: 't',
    })

    saveRoles(storage, session, ['operator'])
    saveRoles(storage, annAgain, ['operator'])
    saveRoles(storage, bobs, ['operator'])

    expect(storage.get(membershipsKeyOf(session.signIn))).toBeDefined()

    forgetSignIn(storage, session.signIn)

    expect(storage.get(rolesKeyOf(session.signIn))).toBeUndefined()
    expect(storage.get(membershipsKeyOf(session.signIn))).toBeUndefined()
    // A record of another sign-in, of the same account or of another one, is no part of it.
    expect(savedRoles(storage, annAgain)).toEqual(['operator'])
    expect(savedRoles(storage, bobs)).toEqual(['operator'])
  })
})
