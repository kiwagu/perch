import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'
import { CONTRACT_ROLES } from '@workspace/kernel'

import { roleShown } from './role-shown'

const bea = identityIdFactory.create()
const cy = identityIdFactory.create()

describe('roleShown', () => {
  it('shows the listed role while nothing was set on the row', () => {
    expect(
      roleShown({
        identity: bea,
        organisation: 'acme',
        listed: CONTRACT_ROLES.member,
        changing: { identity: cy, role: CONTRACT_ROLES.admin, of: 'acme' },
        set: [{ identity: cy, role: CONTRACT_ROLES.admin, read: 1, of: 'acme' }],
        settled: 0,
      }),
    ).toBe('member')
  })

  it('shows the role being set, before the role set earlier', () => {
    expect(
      roleShown({
        identity: bea,
        organisation: 'acme',
        listed: CONTRACT_ROLES.member,
        changing: { identity: bea, role: CONTRACT_ROLES.member, of: 'acme' },
        set: [{ identity: bea, role: CONTRACT_ROLES.admin, read: 1, of: 'acme' }],
        settled: 0,
      }),
    ).toBe('member')
  })

  it('shows the role just set until the read after its change settled', () => {
    const set = [{ identity: bea, role: CONTRACT_ROLES.admin, read: 2, of: 'acme' }] as const
    const shown = (settled: number | undefined) =>
      roleShown({
        identity: bea,
        organisation: 'acme',
        listed: CONTRACT_ROLES.member,
        changing: undefined,
        set,
        settled,
      })

    expect(shown(undefined)).toBe('admin')
    expect(shown(1)).toBe('admin')
    expect(shown(2)).toBe('member')
    expect(shown(3)).toBe('member')
  })

  it('shows no role set in another organisation, whose rows list the same identity', () => {
    expect(
      roleShown({
        identity: bea,
        organisation: 'globex',
        listed: CONTRACT_ROLES.member,
        changing: { identity: bea, role: CONTRACT_ROLES.admin, of: 'acme' },
        set: [{ identity: bea, role: CONTRACT_ROLES.admin, read: 1, of: 'acme' }],
        settled: undefined,
      }),
    ).toBe('member')
  })
})
