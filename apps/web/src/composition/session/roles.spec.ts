import { describe, expect, it, vi } from 'vitest'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import { memoryStorage, rolesKeyOf, saveDevice, savedRoles, saveRoles } from '../storage'

import { SessionRoles } from './roles'

const ann = identityIdFactory.create()
const bob = identityIdFactory.create()

/** A browser where `signedIn` is the saved identity, and roles over it showing `shown`. */
function rolesOf(signedIn: IdentityId | undefined, shown: () => IdentityId | undefined) {
  const storage = memoryStorage()

  if (signedIn) {
    saveDevice(storage, {
      identity: { id: signedIn, email: 'someone@example.test' },
      token: 'token',
      memberships: [],
    })
  }

  const roles = new SessionRoles({ storage, shown })
  const heard: Array<readonly PlatformRole[]> = []

  roles.subscribe((held) => heard.push([...held]))

  return { storage, roles, heard }
}

describe('SessionRoles', () => {
  it("reads the roles of the identity shown from that identity's record", () => {
    const { storage, roles } = rolesOf(ann, () => ann)

    saveRoles(storage, ann, ['operator'])
    roles.followSaved()

    expect([...roles.current()]).toEqual(['operator'])
  })

  it('holds no role while nobody is shown', () => {
    const { storage, roles } = rolesOf(undefined, () => undefined)

    saveRoles(storage, ann, ['operator'])

    expect(roles.current().size).toBe(0)
  })

  it("never reads another identity's record as the shown identity's", () => {
    const { storage, roles } = rolesOf(ann, () => ann)

    saveRoles(storage, bob, ['operator'])
    roles.followSaved()

    expect(roles.current().size).toBe(0)
  })

  it('reads the roles kept for the identity it is first asked about, as a restore shows it', () => {
    const storage = memoryStorage()

    saveRoles(storage, ann, ['operator'])

    expect([...new SessionRoles({ storage, shown: () => ann }).current()]).toEqual(['operator'])
  })

  it('gives the same set until the roles change', () => {
    const { roles } = rolesOf(ann, () => ann)
    const before = roles.current()

    roles.followSaved()

    expect(roles.current()).toBe(before)

    roles.apply(ann, ['operator'])

    expect(roles.current()).not.toBe(before)
  })

  it('keeps the roles a welcome of the signed-in identity carries, and tells the subscribers', () => {
    const { storage, roles, heard } = rolesOf(ann, () => ann)

    roles.apply(ann, ['operator'])

    expect(savedRoles(storage, ann)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
    expect(heard).toEqual([['operator']])
  })

  it('takes a role away when a later welcome does not carry it', () => {
    const { storage, roles, heard } = rolesOf(ann, () => ann)

    roles.apply(ann, ['operator'])
    roles.apply(ann, [])

    expect(savedRoles(storage, ann)).toEqual([])
    expect(roles.current().size).toBe(0)
    expect(heard).toEqual([['operator'], []])
  })

  it.each([
    ['nobody is signed in any more', undefined],
    ['another account is signed in', bob],
  ])('writes nothing for a welcome of an identity no longer signed in: %s', (_why, signedIn) => {
    const { storage, roles, heard } = rolesOf(signedIn, () => ann)
    const set = vi.spyOn(storage, 'set')

    roles.apply(ann, ['operator'])

    expect(set).not.toHaveBeenCalled()
    expect(storage.get(rolesKeyOf(ann))).toBeUndefined()
    expect(roles.current().size).toBe(0)
    expect(heard).toEqual([])
  })

  it('follows a record another tab saved: it reads and tells, and writes nothing', () => {
    const { storage, roles, heard } = rolesOf(ann, () => ann)

    storage.changeElsewhere(rolesKeyOf(ann), JSON.stringify({ identity: ann, roles: ['operator'] }))

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
    const { storage, roles, heard } = rolesOf(ann, () => shown)

    saveRoles(storage, ann, ['operator'])
    roles.followSaved()
    shown = undefined
    roles.tell()

    expect(roles.current().size).toBe(0)

    shown = ann
    roles.tell()

    expect([...roles.current()]).toEqual(['operator'])
    expect(heard).toEqual([['operator'], [], ['operator']])
  })

  it('drops a role from the record of the identity that asked, whichever identity is shown', () => {
    const { storage, roles, heard } = rolesOf(bob, () => bob)

    saveRoles(storage, ann, ['operator'])
    saveRoles(storage, bob, ['operator'])
    roles.followSaved()
    roles.drop(ann, 'operator')

    expect(savedRoles(storage, ann)).toEqual([])
    expect(savedRoles(storage, bob)).toEqual(['operator'])
    expect([...roles.current()]).toEqual(['operator'])
    expect(heard.at(-1)).toEqual(['operator'])
  })

  it("takes the role off the shown identity's roles when it asked", () => {
    const { storage, roles, heard } = rolesOf(ann, () => ann)

    roles.apply(ann, ['operator'])
    roles.drop(ann, 'operator')

    expect(savedRoles(storage, ann)).toEqual([])
    expect(roles.current().size).toBe(0)
    expect(heard).toEqual([['operator'], []])
  })

  it('creates no record when it drops a role of an identity without one', () => {
    const { storage, roles } = rolesOf(ann, () => ann)

    roles.drop(ann, 'operator')

    expect(storage.get(rolesKeyOf(ann))).toBeUndefined()
  })

  it('stops telling a subscriber that let go', () => {
    const { roles } = rolesOf(ann, () => ann)
    const heard: unknown[] = []
    const stop = roles.subscribe((held) => heard.push(held))

    stop()
    roles.apply(ann, ['operator'])

    expect(heard).toEqual([])
  })
})
