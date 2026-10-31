import { describe, expect, it } from 'vitest'

import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import { NO_ABILITY, OWNER_ABILITY } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import { regionsFor, regionsOf } from './device-regions'

describe('regionsFor', () => {
  const identity = identityIdFactory.create()
  const other = identityIdFactory.create()
  const membership = (key: string): Membership => ({
    tenant: { id: tenantIdFactory.create(), key, name: key },
    role: 'member',
  })

  it("makes the identity the owner of its private region and judges its organisation's region by its role", () => {
    const regions = regionsFor(identity, [membership('acme')], replicaSchema)
    const acme = regions.get('tenant:acme')?.actor.ability

    expect(regions.get(`identity:${identity}`)?.actor).toEqual({
      id: identity,
      ability: OWNER_ABILITY,
    })
    expect(acme?.can('update', 'note', { author: `member:${identity}` })).toBe(true)
    expect(acme?.can('update', 'note', { author: `member:${other}` })).toBe(false)
  })

  it('allows nothing in a tenant region whose membership names no organisation key', () => {
    const regions = regionsFor(identity, [membership('Not A Key')], replicaSchema)

    expect(regions.get('tenant:Not A Key')?.actor.ability).toBe(NO_ABILITY)
  })
})

describe('regionsOf', () => {
  it('names the regions a message touches, and none for the messages of the device itself', () => {
    expect(regionsOf({ type: 'probe', regions: ['tenant:acme', 'identity:idn_a'] })).toEqual([
      'tenant:acme',
      'identity:idn_a',
    ])
    expect(regionsOf({ type: 'pull', region: 'tenant:acme', vv: new Uint8Array() })).toEqual([
      'tenant:acme',
    ])
    expect(regionsOf({ type: 'sign-out', scope: 'device' })).toEqual([])
  })
})
