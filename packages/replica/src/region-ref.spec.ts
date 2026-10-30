import { describe, expect, it } from 'vitest'

import { identityRegions, privateRegionId, regionRefOf, tenantKeyOf } from './region-ref'

describe('region references', () => {
  it("names an identity's private region by its id", () => {
    expect(privateRegionId('idn_a')).toBe('identity:idn_a')
  })

  it('tells a private region and a tenant region from their ids, and knows no other', () => {
    expect(regionRefOf('identity:idn_a')).toEqual({ kind: 'private', id: 'identity:idn_a' })
    expect(regionRefOf('tenant:acme')).toEqual({ kind: 'tenant', id: 'tenant:acme' })

    for (const id of [
      'identity:',
      'identity:prf_a',
      'tenant:Acme',
      'tenant:',
      'note:acme',
      'acme',
    ]) {
      expect(regionRefOf(id)).toBeUndefined()
    }
  })

  it("answers a tenant region's organisation key, and none for a private region", () => {
    expect(tenantKeyOf({ kind: 'tenant', id: 'tenant:acme' })).toBe('acme')
    expect(tenantKeyOf({ kind: 'private', id: 'identity:idn_a' })).toBeUndefined()
  })

  it('lists the private region of an identity and the region of each of its organisations', () => {
    const tenant = (key: string) => ({ id: `tnt_${key}`, key, name: key })

    expect(
      identityRegions('idn_a', [
        { tenant: tenant('acme'), role: 'admin' },
        { tenant: tenant('globex'), role: 'member' },
      ]),
    ).toEqual([
      { kind: 'private', id: 'identity:idn_a' },
      { kind: 'tenant', id: 'tenant:acme' },
      { kind: 'tenant', id: 'tenant:globex' },
    ])
  })
})
