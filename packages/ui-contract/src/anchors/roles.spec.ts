import { describe, expect, it } from 'vitest'

import { admits, admitsAllOf, GUEST, heldRoles, IDENTITY, sameAdmission } from './roles'

describe('heldRoles', () => {
  it('holds guest alone while nobody is signed in, whatever else is given', () => {
    expect([...heldRoles(false)]).toEqual([GUEST])
    expect([...heldRoles(false, ['operator'])]).toEqual([GUEST])
  })

  it('holds identity and every other role of a signed-in account, never guest', () => {
    expect([...heldRoles(true)]).toEqual([IDENTITY])
    expect([...heldRoles(true, ['admin', 'operator', GUEST, IDENTITY])]).toEqual([
      IDENTITY,
      'admin',
      'operator',
    ])
  })
})

describe('admits', () => {
  it('admits a device that holds one of the roles, and no other', () => {
    expect(admits(['operator'], heldRoles(true, ['operator']))).toBe(true)
    expect(admits(['operator'], heldRoles(true, ['admin']))).toBe(false)
    expect(admits(['operator'], heldRoles(false))).toBe(false)
    expect(admits([GUEST, IDENTITY], heldRoles(false))).toBe(true)
    expect(admits([GUEST, IDENTITY], heldRoles(true, ['operator']))).toBe(true)
    expect(admits([], heldRoles(true))).toBe(false)
  })
})

const ROLES = [GUEST, IDENTITY, 'member', 'admin', 'operator']

describe('sameAdmission', () => {
  it('equates lists that admit the same devices: a device holding member or admin always holds identity', () => {
    expect(sameAdmission([IDENTITY, 'member', 'admin'], [IDENTITY], ROLES)).toBe(true)
    expect(sameAdmission([IDENTITY], [IDENTITY, 'member', 'admin'], ROLES)).toBe(true)
    expect(sameAdmission(['admin', 'member'], ['member', 'admin'], ROLES)).toBe(true)
    expect(sameAdmission([GUEST, IDENTITY, 'admin'], [IDENTITY, GUEST], ROLES)).toBe(true)
  })

  it('tells lists apart that admit a device the other refuses', () => {
    expect(sameAdmission(['admin'], [IDENTITY], ROLES)).toBe(false)
    expect(sameAdmission([IDENTITY], [GUEST, IDENTITY], ROLES)).toBe(false)
    expect(sameAdmission(['member'], ['admin'], ROLES)).toBe(false)
    expect(sameAdmission([], [IDENTITY], ROLES)).toBe(false)
    expect(sameAdmission([], [], ROLES)).toBe(true)
  })

  it('reads only the roles a device can hold: one the vocabulary lacks is never held', () => {
    expect(sameAdmission([IDENTITY, 'unknown'], [IDENTITY], ROLES)).toBe(true)
    expect(sameAdmission(['unknown'], [], ROLES)).toBe(true)
  })
})

/** Every role set a device can hold: `guest` alone, or `identity` with any subset of the other roles. */
const everyDevice = (roles: readonly string[]): ReadonlySet<string>[] => {
  const others = roles.filter((role) => role !== GUEST && role !== IDENTITY)
  const subsets = Array.from({ length: 2 ** others.length }, (_, mask) =>
    others.filter((_role, index) => (mask >> index) % 2 === 1),
  )

  return [heldRoles(false), ...subsets.map((subset) => heldRoles(true, subset))]
}

describe('admission over every device', () => {
  const lists = [[], [GUEST], [IDENTITY], ['member'], ['admin', 'member'], [IDENTITY, 'operator']]

  it('is decided by the devices that hold one role beside identity, as by every role set a device can hold', () => {
    for (const a of lists) {
      for (const b of lists) {
        expect(sameAdmission(a, b, ROLES)).toBe(
          everyDevice(ROLES).every((held) => admits(a, held) === admits(b, held)),
        )
        expect(admitsAllOf(a, b, ROLES)).toBe(
          everyDevice(ROLES).every((held) => !admits(b, held) || admits(a, held)),
        )
      }
    }
  })
})

describe('admitsAllOf', () => {
  it('holds when the first admits every device the second admits', () => {
    expect(admitsAllOf([GUEST, IDENTITY], [IDENTITY], ROLES)).toBe(true)
    expect(admitsAllOf([IDENTITY], [IDENTITY, 'admin'], ROLES)).toBe(true)
    expect(admitsAllOf([IDENTITY], [], ROLES)).toBe(true)
  })

  it('fails when the second admits a device the first refuses', () => {
    expect(admitsAllOf([IDENTITY], [GUEST, IDENTITY], ROLES)).toBe(false)
    expect(admitsAllOf(['admin'], [IDENTITY], ROLES)).toBe(false)
    expect(admitsAllOf([GUEST], ['admin'], ROLES)).toBe(false)
  })
})
