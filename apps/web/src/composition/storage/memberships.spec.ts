import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { signedIn } from '../__fixtures__/signed-in'

import { memoryStorage } from './key-value'
import {
  isMembershipsKey,
  membershipsKeyOf,
  savedMemberships,
  savedTenant,
  saveMemberships,
  saveTenant,
} from './memberships'
import { rolesKeyOf } from './roles'
import { CURRENT_KEY, newSignInId } from './sign-in'
import { forgetSignIn, signedInKeyOf } from './signed-in'

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-1',
}

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

describe('memberships and the current tenant', () => {
  it("keeps each sign-in's memberships under a key of its own, which the session's other keys are not", () => {
    const signIn = newSignInId()
    const other = newSignInId()

    expect(membershipsKeyOf(signIn)).toBe(`perch.session.memberships.${signIn}`)
    expect(membershipsKeyOf(other)).not.toBe(membershipsKeyOf(signIn))
    expect(isMembershipsKey(membershipsKeyOf(other))).toBe(true)

    for (const key of [
      CURRENT_KEY,
      signedInKeyOf(signIn),
      `perch.session.tenant.${signIn}`,
      rolesKeyOf(signIn),
    ]) {
      expect(isMembershipsKey(key)).toBe(false)
    }
  })

  it("leaves another sign-in's memberships as they are: another account's, and the same account's other sign-in", () => {
    const storage = memoryStorage()
    const annFirst = { signIn: newSignInId(), identity: ann.identity.id }
    const annAgain = { signIn: newSignInId(), identity: ann.identity.id }
    const bob = { signIn: newSignInId(), identity: identityIdFactory.create() }

    saveMemberships(storage, annFirst, [acme])
    saveMemberships(storage, bob, [])
    saveMemberships(storage, annAgain, [])

    expect(savedMemberships(storage, annFirst)).toEqual([acme])
  })

  it('keeps the memberships of the sign-in they were saved for, naming its identity', () => {
    const storage = memoryStorage()
    const owner = { signIn: newSignInId(), identity: ann.identity.id }

    saveMemberships(storage, owner, [acme])

    expect(savedMemberships(storage, owner)).toEqual([acme])
    expect(JSON.parse(storage.get(membershipsKeyOf(owner.signIn)) ?? 'null')).toEqual({
      identity: ann.identity.id,
      memberships: [acme],
    })
  })

  it('saves the memberships with the device', () => {
    const storage = memoryStorage()
    const session = signedIn(storage, { ...ann, memberships: [acme] })

    expect(savedMemberships(storage, session)).toEqual([acme])
  })

  it('reads none for another identity, nor for another sign-in of the same one', () => {
    const storage = memoryStorage()
    const owner = { signIn: newSignInId(), identity: ann.identity.id }

    saveMemberships(storage, owner, [acme])

    expect(
      savedMemberships(storage, { signIn: owner.signIn, identity: identityIdFactory.create() }),
    ).toEqual([])
    expect(savedMemberships(storage, { signIn: newSignInId(), identity: ann.identity.id })).toEqual(
      [],
    )
  })

  it('reads none from a value that does not parse', () => {
    const storage = memoryStorage()
    const owner = { signIn: newSignInId(), identity: ann.identity.id }

    const bob = identityIdFactory.create()

    for (const value of [
      'not json',
      '[]',
      '{"identity":"x","memberships":1}',
      // A record under Ann's sign-in's key that names another identity.
      JSON.stringify({ identity: bob, memberships: [acme] }),
    ]) {
      storage.set(membershipsKeyOf(owner.signIn), value)

      expect(savedMemberships(storage, owner)).toEqual([])
    }
  })

  it("forgetting a sign-in clears its memberships and its tenant, and no other sign-in's", () => {
    const storage = memoryStorage()
    const session = signedIn(storage, { ...ann, memberships: [acme] })
    const annAgain = { signIn: newSignInId(), identity: ann.identity.id }
    const bob = { signIn: newSignInId(), identity: identityIdFactory.create() }

    saveTenant(storage, session.signIn, 'acme')
    saveMemberships(storage, annAgain, [acme])
    saveTenant(storage, annAgain.signIn, 'acme')
    saveMemberships(storage, bob, [acme])
    saveTenant(storage, bob.signIn, 'globex')
    forgetSignIn(storage, session.signIn)

    expect(storage.get(membershipsKeyOf(session.signIn))).toBeUndefined()
    expect(savedTenant(storage, session.signIn)).toBeUndefined()
    // The records of another sign-in, of the same account or of another one, are no part of it.
    expect(savedMemberships(storage, annAgain)).toEqual([acme])
    expect(savedTenant(storage, annAgain.signIn)).toBe('acme')
    expect(savedMemberships(storage, bob)).toEqual([acme])
    expect(savedTenant(storage, bob.signIn)).toBe('globex')
  })

  it("keeps the tenant chosen during a sign-in as plain text under its key, apart from another sign-in's", () => {
    const storage = memoryStorage()
    const signIn = newSignInId()
    const other = newSignInId()

    expect(savedTenant(storage, signIn)).toBeUndefined()

    saveTenant(storage, signIn, 'acme')

    expect(storage.get(`perch.session.tenant.${signIn}`)).toBe('acme')
    expect(savedTenant(storage, signIn)).toBe('acme')
    expect(savedTenant(storage, other)).toBeUndefined()

    saveTenant(storage, other, 'globex')

    expect(savedTenant(storage, signIn)).toBe('acme')
    expect(savedTenant(storage, other)).toBe('globex')
  })
})
