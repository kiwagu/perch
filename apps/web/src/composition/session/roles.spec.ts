import { describe, expect, it, vi } from 'vitest'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import { signedIn, signedOut } from '../__fixtures__/signed-in'
import {
  type KeptSession,
  type KeyValueStorage,
  memoryStorage,
  rolesKeyOf,
  savedRoles,
  saveRoles,
} from '../storage'

import { SessionRoles } from './roles'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

/** A sign-in of `identity` on the browser of `storage`; answers its session. */
function signedInAs(storage: KeyValueStorage, identity: IdentityId): KeptSession {
  return signedIn(storage, {
    identity: { id: identity, email: 'someone@example.test' },
    token: 'token',
  })
}

/** A browser where `who` is the saved sign-in, and roles over it showing `shown`. */
function rolesOf(who: IdentityId, shown: () => IdentityId | undefined) {
  const storage = memoryStorage()
  const session = signedInAs(storage, who)
  const roles = new SessionRoles({ storage, shown })
  const heard: Array<readonly PlatformRole[]> = []

  roles.subscribe((held) => heard.push([...held]))

  return { storage, session, roles, heard }
}

describe('SessionRoles', () => {
  it("reads the roles of the identity shown from that identity's record", () => {
    const { storage, session, roles } = rolesOf(ann, () => ann)

    saveRoles(storage, session, ['operator'])
    roles.followSaved()

    expect([...roles.current()]).toEqual(['operator'])
  })

  it('holds no role while nobody is shown', () => {
    const { storage, session, roles } = rolesOf(ann, () => undefined)

    saveRoles(storage, session, ['operator'])

    expect(roles.current().size).toBe(0)
  })

  it("never reads another identity's record as the shown identity's", () => {
    // Bob's sign-in is the one saved on the browser now; this tab still shows Ann.
    const { storage, session, roles } = rolesOf(bob, () => ann)

    saveRoles(storage, session, ['operator'])
    roles.followSaved()

    expect(roles.current().size).toBe(0)
  })

  it('reads the roles kept for the identity it is first asked about, as a restore shows it', () => {
    const storage = memoryStorage()

    saveRoles(storage, signedInAs(storage, ann), ['operator'])

    expect([...new SessionRoles({ storage, shown: () => ann }).current()]).toEqual(['operator'])
  })

  it('gives the same set until the roles change', () => {
    const { session, roles } = rolesOf(ann, () => ann)
    const before = roles.current()

    roles.followSaved()

    expect(roles.current()).toBe(before)

    roles.apply(session, ['operator'])

    expect(roles.current()).not.toBe(before)
  })

  it('keeps the roles a welcome of the signed-in identity carries, and tells the subscribers', () => {
    const { storage, session, roles, heard } = rolesOf(ann, () => ann)

    roles.apply(session, ['operator'])

    expect(savedRoles(storage, session)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
    expect(heard).toEqual([['operator']])
  })

  it('takes a role away when a later welcome does not carry it', () => {
    const { storage, session, roles, heard } = rolesOf(ann, () => ann)

    roles.apply(session, ['operator'])
    roles.apply(session, [])

    expect(savedRoles(storage, session)).toEqual([])
    expect(roles.current().size).toBe(0)
    expect(heard).toEqual([['operator'], []])
  })

  it.each([
    ['nobody is signed in any more', undefined],
    ['another account is signed in', bob],
  ])('writes nothing for a welcome of an identity no longer signed in: %s', (_why, next) => {
    // The welcome is of Ann's sign-in, which ended before it landed.
    const { storage, session, roles, heard } = rolesOf(ann, () => ann)

    if (next) {
      signedInAs(storage, next)
    } else {
      signedOut(storage)
    }

    const set = vi.spyOn(storage, 'set')

    roles.apply(session, ['operator'])

    expect(set).not.toHaveBeenCalled()
    expect(storage.get(rolesKeyOf(session.signIn))).toBeUndefined()
    expect(roles.current().size).toBe(0)
    expect(heard).toEqual([])
  })

  it('follows a record another tab saved: it reads and tells, and writes nothing', () => {
    const { storage, session, roles, heard } = rolesOf(ann, () => ann)

    storage.changeElsewhere(
      rolesKeyOf(session.signIn),
      JSON.stringify({ identity: ann, roles: ['operator'] }),
    )

    const set = vi.spyOn(storage, 'set')
    const remove = vi.spyOn(storage, 'remove')

    roles.followSaved()

    expect([...roles.current()]).toEqual(['operator'])
    expect(heard).toEqual([['operator']])
    expect(set).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('reads the record of the identity shown anew when that identity changes', () => {
    let shown: IdentityId | undefined = ann
    const { storage, session, roles, heard } = rolesOf(ann, () => shown)

    saveRoles(storage, session, ['operator'])
    roles.followSaved()
    shown = undefined
    roles.tell()

    expect(roles.current().size).toBe(0)

    shown = ann
    roles.tell()

    expect([...roles.current()]).toEqual(['operator'])
    expect(heard).toEqual([['operator'], [], ['operator']])
  })

  it('drops a role from the record of the sign-in that asked, whichever sign-in is shown or current', () => {
    // Ann's sign-in is the one saved on the browser; this tab still shows Bob.
    const { storage, session: anns, roles, heard } = rolesOf(ann, () => bob)

    saveRoles(storage, anns, ['operator'])
    roles.drop(anns, 'operator')

    expect(savedRoles(storage, anns)).toEqual([])

    // Bob signs in with the role, and is shown; a refusal of Ann's earlier request lands after it.
    const bobs = signedInAs(storage, bob)

    saveRoles(storage, bobs, ['operator'])
    roles.followSaved()
    roles.drop(anns, 'operator')

    expect(savedRoles(storage, bobs)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
    expect(heard.at(-1)).toEqual(['operator'])
  })

  it("takes the role off the shown identity's roles when it asked", () => {
    const { storage, session, roles, heard } = rolesOf(ann, () => ann)

    roles.apply(session, ['operator'])
    roles.drop(session, 'operator')

    expect(savedRoles(storage, session)).toEqual([])
    expect(roles.current().size).toBe(0)
    expect(heard).toEqual([['operator'], []])
  })

  it("leaves the role of the same account's later sign-in, asked for by an earlier one", () => {
    const { storage, session: first, roles } = rolesOf(ann, () => ann)

    saveRoles(storage, first, ['operator'])

    const again = signedInAs(storage, ann)

    saveRoles(storage, again, ['operator'])
    roles.drop(first, 'operator')

    expect(savedRoles(storage, again)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
  })

  it('creates no record when it drops a role of a sign-in without one', () => {
    const { storage, session, roles } = rolesOf(ann, () => ann)

    roles.drop(session, 'operator')

    expect(storage.get(rolesKeyOf(session.signIn))).toBeUndefined()
  })

  it('stops telling a subscriber that let go', () => {
    const { session, roles } = rolesOf(ann, () => ann)
    const heard: unknown[] = []
    const stop = roles.subscribe((held) => heard.push(held))

    stop()
    roles.apply(session, ['operator'])

    expect(heard).toEqual([])
  })
})
