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

/** The client address the verification mails come from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** The answers of `count` calls of `ask`, one after the other. */
function answers<T>(count: number, ask: (n: number) => T): T[] {
  return Array.from({ length: count }, (_, n) => ask(n))
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

  it('lets 10 sign-ins of an email fail within 15 minutes and refuses the 11th', async () => {
    const { clock, limits } = limitsOn()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    await clock.advance(5 * minute)
    expect(limits.signInAttempt('ann@example.test')).toEqual({
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

  it("clears an email's failures and sign-ins under way once it signs in", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < 8; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    limits.signInAttempt('ann@example.test')
    settle(limits.signInAttempt('ann@example.test'), 'succeeded')

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    }
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

  it('takes three resends of an email within 15 minutes, refuses the fourth, and the refused one costs its address nothing', async () => {
    const { clock, limits } = limitsOn()

    expect(answers(3, () => limits.verificationMail(FROM, 'ghost@example.test'))).toEqual(
      answers(3, () => ({ allowed: true })),
    )
    await clock.advance(5 * minute)
    expect(limits.verificationMail(FROM, 'ghost@example.test')).toEqual({
      allowed: false,
      retryAfterMs: 10 * minute,
    })
    // The address took three of its 200: 197 more fit, the refused resend's place given back.
    expect(answers(197, () => limits.verificationMail(FROM).allowed)).toEqual(
      answers(197, () => true),
    )
    expect(limits.verificationMail(FROM).allowed).toBe(false)
  })

  it('takes 200 verification mails of one address within 15 minutes, sign-ups and resends together, and refuses the 201st of either kind', async () => {
    const { clock, limits } = limitsOn()
    const mixed = answers(200, (n) =>
      n % 2 === 0
        ? limits.verificationMail(FROM)
        : limits.verificationMail(FROM, `user-${n}@example.test`),
    )

    expect(mixed).toEqual(answers(200, () => ({ allowed: true })))
    await clock.advance(5 * minute)
    expect(limits.verificationMail(FROM)).toEqual({ allowed: false, retryAfterMs: 10 * minute })
    expect(limits.verificationMail(FROM, 'fresh@example.test')).toEqual({
      allowed: false,
      retryAfterMs: 10 * minute,
    })
    // Another address keeps its own budget.
    expect(limits.verificationMail(ELSEWHERE)).toEqual({ allowed: true })
    expect(limits.verificationMail(ELSEWHERE, 'fresh@example.test')).toEqual({ allowed: true })
  })

  it("leaves an email's resends untouched by the resends its address's budget refuses", () => {
    const { limits } = limitsOn()

    answers(200, () => limits.verificationMail(FROM))

    expect(answers(3, () => limits.verificationMail(FROM, 'victim@example.test').allowed)).toEqual([
      false,
      false,
      false,
    ])
    // The victim's three resends are all still there, from anywhere else.
    expect(
      answers(4, () => limits.verificationMail(ELSEWHERE, 'victim@example.test').allowed),
    ).toEqual([true, true, true, false])
  })

  it("opens the address's and the email's windows again once 15 minutes have passed", async () => {
    const { clock, limits } = limitsOn()

    answers(3, () => limits.verificationMail(FROM, 'ghost@example.test'))
    answers(197, () => limits.verificationMail(FROM))

    expect(limits.verificationMail(FROM).allowed).toBe(false)
    expect(limits.verificationMail(ELSEWHERE, 'ghost@example.test').allowed).toBe(false)

    await clock.advance(15 * minute)

    expect(limits.verificationMail(FROM, 'ghost@example.test')).toEqual({ allowed: true })
    expect(limits.verificationMail(FROM)).toEqual({ allowed: true })
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
