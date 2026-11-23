import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { accountStartKeyOf, keptAccountStart } from './account-start'
import { type KeyValueStorage, memoryStorage } from './key-value'
import { membershipsKeyOf, savedMemberships, savedTenant, saveTenant } from './memberships'
import { rolesKeyOf, savedRoles, saveRoles } from './roles'
import { CURRENT_KEY, type KeptSession, newSignInId } from './sign-in'
import {
  dropUnreadableSignIn,
  forgetSignIn,
  saveDevice,
  savedIdentity,
  savedSession,
  savedToken,
  savedTokenOf,
  saveIdentityEmail,
  sessionKept,
  signedInKeyOf,
} from './signed-in'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-1',
  memberships: [acme],
}

/** Saves `device` as a new sign-in and answers its session. */
function save(storage: KeyValueStorage, device: typeof ann): KeptSession {
  const signIn = newSignInId()

  saveDevice(storage, signIn, device)

  return { signIn, identity: device.identity.id, token: device.token }
}

/** The storage, with every key written or removed through it recorded in order. */
function watched() {
  const storage = memoryStorage()
  const changed: string[] = []
  const watching: KeyValueStorage = {
    ...storage,
    set: (key, value) => {
      changed.push(`set ${key}`)
      storage.set(key, value)
    },
    remove: (key) => {
      if (storage.get(key) !== undefined) {
        changed.push(`remove ${key}`)
      }

      storage.remove(key)
    },
  }

  return { storage, watching, changed }
}

describe('the signed-in device', () => {
  it('keeps the sign-in under its own id: its identity, token and memberships, the pointer naming it', () => {
    const storage = memoryStorage()
    const session = save(storage, ann)

    expect(storage.get(CURRENT_KEY)).toBe(session.signIn)
    expect(JSON.parse(storage.get(signedInKeyOf(session.signIn)) ?? 'null')).toEqual({
      identity: ann.identity.id,
      email: ann.identity.email,
      token: 'token-1',
    })
    expect(savedIdentity(storage)).toEqual(ann.identity)
    expect(savedSession(storage)).toEqual(session)
    expect(savedToken(storage)).toBe('token-1')
    expect(savedMemberships(storage, session)).toEqual([acme])
    expect(sessionKept(storage, session)).toBe(true)
  })

  it('gives the token for the identity it was issued to alone', () => {
    const storage = memoryStorage()

    save(storage, ann)

    expect(savedTokenOf(storage, ann.identity.id)).toBe('token-1')
    expect(savedTokenOf(storage, identityIdFactory.create())).toBeUndefined()
  })

  it('writes the record, then the memberships, the pointer last, then clears what older builds kept', () => {
    const { storage, watching, changed } = watched()

    for (const key of ['perch.session.identity', 'perch.session.token', 'perch.session.refresh']) {
      storage.set(key, 'older')
    }

    const session = save(watching, ann)

    expect(changed).toEqual([
      `set ${signedInKeyOf(session.signIn)}`,
      `set ${membershipsKeyOf(session.signIn)}`,
      `set ${CURRENT_KEY}`,
      'remove perch.session.identity',
      'remove perch.session.token',
      'remove perch.session.refresh',
    ])
  })

  it('forgets everything a sign-in kept under its id, and leaves the pointer naming nobody', () => {
    const storage = memoryStorage()
    const session = save(storage, ann)

    saveTenant(storage, session.signIn, 'acme')
    saveRoles(storage, session, ['operator'])
    saveIdentityEmail(storage, ann.identity.id, 'ann@new.example.test', session)
    keptAccountStart(storage).keep(session.signIn, {
      identity: ann.identity.id,
      name: 'Ann',
      locale: 'en',
    })

    forgetSignIn(storage, session.signIn)

    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
    expect(savedToken(storage)).toBeUndefined()
    expect(sessionKept(storage, session)).toBe(false)
    expect(storage.get(signedInKeyOf(session.signIn))).toBeUndefined()
    expect(storage.get(`perch.session.email.${session.signIn}`)).toBeUndefined()
    expect(storage.get(membershipsKeyOf(session.signIn))).toBeUndefined()
    expect(savedTenant(storage, session.signIn)).toBeUndefined()
    expect(storage.get(rolesKeyOf(session.signIn))).toBeUndefined()
    expect(storage.get(accountStartKeyOf(session.signIn))).toBeUndefined()
    // The pointer stays: it names a sign-in whose records are gone, which is nobody.
    expect(storage.get(CURRENT_KEY)).toBe(session.signIn)
  })

  it('forgets only the sign-in it names: the current one, under another id, stays whole', () => {
    const storage = memoryStorage()
    const earlier = save(storage, ann)
    const current = save(storage, { ...ann, token: 'token-2' })

    saveRoles(storage, current, ['operator'])
    forgetSignIn(storage, earlier.signIn)

    expect(savedSession(storage)).toEqual(current)
    expect(savedMemberships(storage, current)).toEqual([acme])
    expect(savedRoles(storage, current)).toEqual(['operator'])
  })

  it("lets an account's next sign-in replace its earlier one: what the earlier kept goes once the pointer moved", () => {
    const { storage, watching, changed } = watched()
    const earlier = save(storage, ann)

    saveTenant(storage, earlier.signIn, 'acme')

    const next = save(watching, { ...ann, token: 'token-2' })

    expect(changed).toEqual([
      `set ${signedInKeyOf(next.signIn)}`,
      `set ${membershipsKeyOf(next.signIn)}`,
      `set ${CURRENT_KEY}`,
      `remove ${signedInKeyOf(earlier.signIn)}`,
      `remove ${membershipsKeyOf(earlier.signIn)}`,
      `remove perch.session.tenant.${earlier.signIn}`,
    ])
    expect(savedSession(storage)).toEqual(next)
  })

  it('names nobody signed in from a record the pointer does not name yet: a save that broke before it', () => {
    const storage = memoryStorage()
    const signIn = newSignInId()

    storage.set(
      signedInKeyOf(signIn),
      JSON.stringify({ identity: ann.identity.id, email: ann.identity.email, token: 'token-1' }),
    )

    expect(savedIdentity(storage)).toBeUndefined()
    expect(savedSession(storage)).toBeUndefined()
  })

  it('reads no identity from a record that does not describe one', () => {
    const storage = memoryStorage()

    storage.set(CURRENT_KEY, 'sign-in')

    for (const value of [
      'not json',
      '{"identity":"prf_x","email":"a@example.test","token":"t"}',
      JSON.stringify({ identity: ann.identity.id, email: ann.identity.email }),
      '[]',
    ]) {
      storage.set(signedInKeyOf('sign-in'), value)

      expect(savedIdentity(storage)).toBeUndefined()
      expect(savedToken(storage)).toBeUndefined()
    }
  })

  it('drops a record the pointer names that does not read as one, and nothing else', () => {
    const storage = memoryStorage()
    const earlier = save(storage, ann)

    storage.set(CURRENT_KEY, 'broken')
    storage.set(signedInKeyOf('broken'), 'not json')
    dropUnreadableSignIn(storage)

    expect(storage.get(signedInKeyOf('broken'))).toBeUndefined()
    expect(sessionKept(storage, earlier)).toBe(true)

    // A pointer whose record is gone already leaves nothing to do.
    storage.set(CURRENT_KEY, earlier.signIn)
    forgetSignIn(storage, earlier.signIn)
    dropUnreadableSignIn(storage)

    expect(storage.get(CURRENT_KEY)).toBe(earlier.signIn)
  })
})
