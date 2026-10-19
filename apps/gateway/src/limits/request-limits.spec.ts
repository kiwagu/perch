import { describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { RequestLimits, type SignInAttempt, type SignInOutcome } from './request-limits'

const minute = 60_000

const ann = idSchemas.identity.schema.parse('idn_ann')
const bob = idSchemas.identity.schema.parse('idn_bob')

/** Settles a sign-in the limits let through; one they refused fails the test. */
function settle(attempt: SignInAttempt, outcome: SignInOutcome): void {
  if (!attempt.allowed) {
    expect.unreachable('the sign-in was refused')
  }

  attempt.settle(outcome)
}

function limitsOn() {
  const clock = manualClock(1_000)

  return { clock, limits: new RequestLimits({ clock }) }
}

describe('RequestLimits', () => {
  it('takes 20 credential checks of one address within 10 s and refuses the 21st with the rest of the window', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(limits.credentials('203.0.113.7')).toEqual({ allowed: true })
    }

    await clock.advance(4_000)
    expect(limits.credentials('203.0.113.7')).toEqual({ allowed: false, retryAfterMs: 6_000 })
    expect(limits.credentials('203.0.113.8')).toEqual({ allowed: true })
    await clock.advance(6_000)
    expect(limits.credentials('203.0.113.7')).toEqual({ allowed: true })
  })

  it('counts the credential checks of an IPv6 address by its /64', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      limits.credentials(`2001:db8:1:2::${attempt.toString(16)}`)
    }

    expect(limits.credentials('2001:db8:1:2:ffff::1').allowed).toBe(false)
    expect(limits.credentials('2001:db8:1:3::1').allowed).toBe(true)
  })

  it('lets 10 sign-ins of an email fail within 15 minutes, whatever its case, and refuses the 11th', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      settle(
        limits.signInAttempt(attempt % 2 === 0 ? 'ann@example.test' : 'ANN@Example.Test'),
        'failed',
      )
    }

    await clock.advance(5 * minute)
    expect(limits.signInAttempt('Ann@example.test')).toEqual({
      allowed: false,
      retryAfterMs: 10 * minute,
    })
    expect(limits.signInAttempt('bob@example.test').allowed).toBe(true)
    await clock.advance(10 * minute)
    expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
  })

  it('holds a place for each sign-in of an email still under way', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    }

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it('gives the place of a sign-in the database could not judge back', () => {
    const { limits } = limitsOn()
    const unjudged = limits.signInAttempt('ann@example.test')

    for (let attempt = 0; attempt < 9; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    settle(unjudged, 'unjudged')

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it('settles a sign-in once: a second settle of the same sign-in changes nothing', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 9; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    const last = limits.signInAttempt('ann@example.test')

    settle(last, 'failed')
    settle(last, 'unjudged')
    settle(last, 'succeeded')

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it("clears an email's failures and sign-ins under way once one signs in, whatever its case", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 8; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    limits.signInAttempt('ann@example.test')
    settle(limits.signInAttempt('ANN@example.test'), 'succeeded')

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    }
  })

  it('takes 10 renewals of one device within 15 minutes and refuses the 11th with the rest of the window', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limits.renewal('203.0.113.7', 'device-laptop')).toEqual({ allowed: true })
    }

    await clock.advance(5 * minute)
    expect(limits.renewal('203.0.113.7', 'device-laptop')).toEqual({
      allowed: false,
      retryAfterMs: 10 * minute,
    })
    // Another device from the same address still renews.
    expect(limits.renewal('203.0.113.7', 'device-phone')).toEqual({ allowed: true })
    await clock.advance(10 * minute)
    expect(limits.renewal('203.0.113.7', 'device-laptop')).toEqual({ allowed: true })
  })

  it('takes 120 renewals of one address across devices within a minute and refuses the 121st', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 120; attempt += 1) {
      expect(limits.renewal('203.0.113.7', `device-${attempt}`)).toEqual({ allowed: true })
    }

    await clock.advance(20_000)
    expect(limits.renewal('203.0.113.7', 'device-120')).toEqual({
      allowed: false,
      retryAfterMs: 40_000,
    })
    expect(limits.renewal('203.0.113.8', 'device-121')).toEqual({ allowed: true })
    await clock.advance(40_000)
    expect(limits.renewal('203.0.113.7', 'device-122')).toEqual({ allowed: true })
  })

  it("leaves the address uncharged by a renewal its device's limit refuses", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limits.renewal('203.0.113.7', 'device-laptop')
    }

    // 110 refusals of the laptop take nothing of the address's 120.
    for (let attempt = 0; attempt < 110; attempt += 1) {
      expect(limits.renewal('203.0.113.7', 'device-laptop').allowed).toBe(false)
    }

    for (let attempt = 0; attempt < 110; attempt += 1) {
      expect(limits.renewal('203.0.113.7', `device-${attempt}`)).toEqual({ allowed: true })
    }

    expect(limits.renewal('203.0.113.7', 'device-110').allowed).toBe(false)
  })

  it('takes 30 invitations of one identity within 10 minutes, from any addresses, and refuses the 31st with the rest of the window', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(limits.invite(ann, `203.0.113.${attempt}`)).toEqual({ allowed: true })
    }

    await clock.advance(4 * minute)
    expect(limits.invite(ann, '203.0.113.99')).toEqual({ allowed: false, retryAfterMs: 6 * minute })
    expect(limits.invite(bob, '203.0.113.99')).toEqual({ allowed: true })
    await clock.advance(6 * minute)
    expect(limits.invite(ann, '203.0.113.99')).toEqual({ allowed: true })
  })

  it('takes 60 invitations of one address across identities within 10 minutes and refuses the 61st', async () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect(limits.invite(attempt < 30 ? ann : bob, '203.0.113.7')).toEqual({ allowed: true })
    }

    expect(limits.invite(idSchemas.identity.schema.parse('idn_cat'), '203.0.113.7').allowed).toBe(
      false,
    )
    expect(limits.invite(idSchemas.identity.schema.parse('idn_cat'), '203.0.113.8').allowed).toBe(
      true,
    )
  })

  it("leaves the address uncharged by an invitation its identity's limit refuses", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 30; attempt += 1) {
      limits.invite(ann, '203.0.113.7')
    }

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(limits.invite(ann, '203.0.113.7').allowed).toBe(false)
    }

    // The 30 refusals took nothing of the address's 60: 30 more fit.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(limits.invite(bob, '203.0.113.7')).toEqual({ allowed: true })
    }
  })

  it('takes 10 organisation creations of one identity within an hour, from any addresses, and refuses the 11th', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limits.createOrganisation(ann, `203.0.113.${attempt}`)).toEqual({ allowed: true })
    }

    await clock.advance(20 * minute)
    expect(limits.createOrganisation(ann, '203.0.113.99')).toEqual({
      allowed: false,
      retryAfterMs: 40 * minute,
    })
    expect(limits.createOrganisation(bob, '203.0.113.99')).toEqual({ allowed: true })
    await clock.advance(40 * minute)
    expect(limits.createOrganisation(ann, '203.0.113.99')).toEqual({ allowed: true })
  })

  it('takes 30 organisation creations of one address across identities within an hour and refuses the 31st', async () => {
    const { clock, limits } = limitsOn()
    const identity = (n: number) => idSchemas.identity.schema.parse(`idn_${n}`)

    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(limits.createOrganisation(identity(attempt % 3), '203.0.113.7')).toEqual({
        allowed: true,
      })
    }

    await clock.advance(15 * minute)
    expect(limits.createOrganisation(identity(3), '203.0.113.7')).toEqual({
      allowed: false,
      retryAfterMs: 45 * minute,
    })
    expect(limits.createOrganisation(identity(3), '203.0.113.8')).toEqual({ allowed: true })
    await clock.advance(45 * minute)
    expect(limits.createOrganisation(identity(4), '203.0.113.7')).toEqual({ allowed: true })
  })

  it("leaves the address uncharged by a creation its identity's limit refuses", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limits.createOrganisation(ann, '203.0.113.7')
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(limits.createOrganisation(ann, '203.0.113.7').allowed).toBe(false)
    }

    // The 20 refusals took nothing of the address's 30: 20 more fit.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const creator = idSchemas.identity.schema.parse(attempt < 10 ? 'idn_bob' : 'idn_cat')

      expect(limits.createOrganisation(creator, '203.0.113.7')).toEqual({ allowed: true })
    }

    expect(
      limits.createOrganisation(idSchemas.identity.schema.parse('idn_dan'), '203.0.113.7'),
    ).toEqual({ allowed: false, retryAfterMs: 60 * minute })
  })
})
