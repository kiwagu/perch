import { describe, expect, it } from 'vitest'

import { admits, GUEST, heldRoles, IDENTITY } from './roles'

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
