import { describe, expect, it } from 'vitest'

import { manualClock } from '@workspace/replica/testing'

import { RequestLimits } from './request-limits'

const minute = 60_000

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

  it('refuses a sign-in of an email after 10 failures within 15 minutes, whatever its case', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limits.signInAllowed('ann@example.test')).toEqual({ allowed: true })
      limits.signInFailed(attempt % 2 === 0 ? 'ann@example.test' : 'ANN@Example.Test')
    }

    await clock.advance(5 * minute)
    expect(limits.signInAllowed('Ann@example.test')).toEqual({
      allowed: false,
      retryAfterMs: 10 * minute,
    })
    expect(limits.signInAllowed('bob@example.test')).toEqual({ allowed: true })
    await clock.advance(10 * minute)
    expect(limits.signInAllowed('ann@example.test')).toEqual({ allowed: true })
  })

  it('checks a sign-in without counting it', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 30; attempt += 1) {
      limits.signInAllowed('ann@example.test')
    }

    expect(limits.signInAllowed('ann@example.test')).toEqual({ allowed: true })
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

  it("clears an email's failures once it signs in, whatever its case", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limits.signInFailed('ann@example.test')
    }

    limits.signInSucceeded('ANN@example.test')

    expect(limits.signInAllowed('ann@example.test')).toEqual({ allowed: true })
  })
})
