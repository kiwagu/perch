import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { roleShown } from './role-shown'

const bea = identityIdFactory.create()
const cy = identityIdFactory.create()

describe('roleShown', () => {
  it('shows the listed role while nothing was set on the row', () => {
    expect(
      roleShown({
        identity: bea,
        listed: 'member',
        changing: { identity: cy, role: 'admin' },
        set: [{ identity: cy, role: 'admin', read: 1 }],
        settled: 0,
      }),
    ).toBe('member')
  })

  it('shows the role being set, before the role set earlier', () => {
    expect(
      roleShown({
        identity: bea,
        listed: 'member',
        changing: { identity: bea, role: 'member' },
        set: [{ identity: bea, role: 'admin', read: 1 }],
        settled: 0,
      }),
    ).toBe('member')
  })

  it('shows the role just set until the read after its change settled', () => {
    const set = [{ identity: bea, role: 'admin', read: 2 }] as const
    const shown = (settled: number | undefined) =>
      roleShown({ identity: bea, listed: 'member', changing: undefined, set, settled })

    expect(shown(undefined)).toBe('admin')
    expect(shown(1)).toBe('admin')
    expect(shown(2)).toBe('member')
    expect(shown(3)).toBe('member')
  })
})
