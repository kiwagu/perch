import { describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { RequestLimits, type SignInAttempt, type SignInOutcome } from './request-limits'
import {
  ADDRESS_INVITES,
  ADDRESS_LINK_ATTEMPTS,
  ADDRESS_MAILS,
  CREDENTIAL_CHECKS,
  EMAIL_VERIFICATION_MAILS,
  FAILED_SIGN_INS,
  IDENTITY_EMAIL_CHANGES,
  IDENTITY_INVITES,
} from './windows'

const minute = 60_000

/** The credential checks of an address, the failed sign-ins of an email, the invitations of an identity and the mails of an address, as the contract allows them. */
const CHECKS = CREDENTIAL_CHECKS.limit
const FAILURES = FAILED_SIGN_INS.limit
const INVITES = IDENTITY_INVITES.limit
const MAILS = ADDRESS_MAILS.limit

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
  it("takes an address's credential checks within their window and refuses the next with the rest of the window", async () => {
    const { clock, limits } = limitsOn()
    const rest = CREDENTIAL_CHECKS.windowMs - 4_000

    for (let attempt = 0; attempt < CHECKS; attempt += 1) {
      expect(limits.credentials('203.0.113.7')).toEqual({ allowed: true })
    }

    await clock.advance(4_000)
    expect(limits.credentials('203.0.113.7')).toEqual({ allowed: false, retryAfterMs: rest })
    expect(limits.credentials('203.0.113.8')).toEqual({ allowed: true })
    await clock.advance(rest)
    expect(limits.credentials('203.0.113.7')).toEqual({ allowed: true })
  })

  it('counts the credential checks of an IPv6 address by its /64', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < CHECKS; attempt += 1) {
      limits.credentials(`2001:db8:1:2::${attempt.toString(16)}`)
    }

    expect(limits.credentials('2001:db8:1:2:ffff::1').allowed).toBe(false)
    expect(limits.credentials('2001:db8:1:3::1').allowed).toBe(true)
  })

  it("lets an email's sign-ins fail as often as allowed within their window and refuses the next", async () => {
    const { clock, limits } = limitsOn()
    const rest = FAILED_SIGN_INS.windowMs - 5 * minute

    for (let attempt = 0; attempt < FAILURES; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    await clock.advance(5 * minute)
    expect(limits.signInAttempt('ann@example.test')).toEqual({
      allowed: false,
      retryAfterMs: rest,
    })
    expect(limits.signInAttempt('bob@example.test').allowed).toBe(true)
    await clock.advance(rest)
    expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
  })

  it('holds a place for each sign-in of an email still under way', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < FAILURES; attempt += 1) {
      expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    }

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it('gives the place of a sign-in the database could not judge back', () => {
    const { limits } = limitsOn()
    const unjudged = limits.signInAttempt('ann@example.test')

    for (let attempt = 1; attempt < FAILURES; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    settle(unjudged, 'unjudged')

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it('settles a sign-in once: a second settle of the same sign-in changes nothing', () => {
    const { limits } = limitsOn()

    for (let attempt = 1; attempt < FAILURES; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    const last = limits.signInAttempt('ann@example.test')

    settle(last, 'failed')
    settle(last, 'unjudged')
    settle(last, 'succeeded')

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it("counts a failure judged after another sign-in of the email succeeded meanwhile, in the email's new window", () => {
    const { limits } = limitsOn()

    for (let attempt = 2; attempt < FAILURES; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    const waiting = limits.signInAttempt('ann@example.test')

    settle(limits.signInAttempt('ann@example.test'), 'succeeded')
    settle(waiting, 'failed')

    // The failure is the first of the new window: the rest of the limit fills it.
    for (let attempt = 1; attempt < FAILURES; attempt += 1) {
      expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    }

    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it("keeps a failure judged after a success counted when newer sign-ins filled the email's new window and one of them gives its place back", () => {
    const { limits } = limitsOn()
    const waiting = limits.signInAttempt('ann@example.test')

    settle(limits.signInAttempt('ann@example.test'), 'succeeded')

    const newer = answers(FAILURES, () => limits.signInAttempt('ann@example.test'))

    expect(newer.map((attempt) => attempt.allowed)).toEqual(answers(FAILURES, () => true))

    settle(waiting, 'failed')

    const [first] = newer

    settle(first ?? expect.unreachable('a newer sign-in'), 'unjudged')

    // The newer sign-ins under way but that one, and the failure, fill the window.
    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)
  })

  it("clears an email's failures and sign-ins under way once it signs in", () => {
    const { limits } = limitsOn()

    for (let attempt = 2; attempt < FAILURES; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    limits.signInAttempt('ann@example.test')
    settle(limits.signInAttempt('ann@example.test'), 'succeeded')

    for (let attempt = 0; attempt < FAILURES; attempt += 1) {
      expect(limits.signInAttempt('ann@example.test').allowed).toBe(true)
    }
  })

  it("forgets an email's failures and sign-ins under way as a sign-in that succeeded does, holding no place", () => {
    const { limits } = limitsOn()

    for (let attempt = 1; attempt < FAILURES; attempt += 1) {
      settle(limits.signInAttempt('ann@example.test'), 'failed')
    }

    // One sign-in still under way holds the last place.
    limits.signInAttempt('ann@example.test')
    expect(limits.signInAttempt('ann@example.test').allowed).toBe(false)

    limits.forgetFailedSignIns('ann@example.test')
    // Forgetting again, and forgetting an email with no failures, holds no place either.
    limits.forgetFailedSignIns('ann@example.test')
    limits.forgetFailedSignIns('bob@example.test')

    for (const email of ['ann@example.test', 'bob@example.test']) {
      for (let attempt = 0; attempt < FAILURES; attempt += 1) {
        expect(limits.signInAttempt(email).allowed).toBe(true)
      }

      expect(limits.signInAttempt(email).allowed).toBe(false)
    }
  })

  it("takes an identity's invitations within their window, from any addresses, and refuses the next with the rest of the window", async () => {
    const { clock, limits } = limitsOn()
    const rest = IDENTITY_INVITES.windowMs - 4 * minute

    for (let attempt = 0; attempt < INVITES; attempt += 1) {
      expect(limits.inviteMail(ann, `203.0.113.${attempt}`)).toEqual({ allowed: true })
    }

    await clock.advance(4 * minute)
    expect(limits.inviteMail(ann, '203.0.113.250')).toEqual({
      allowed: false,
      retryAfterMs: rest,
    })
    expect(limits.inviteMail(bob, '203.0.113.250')).toEqual({ allowed: true })
    await clock.advance(rest)
    expect(limits.inviteMail(ann, '203.0.113.250')).toEqual({ allowed: true })
  })

  it("takes an address's invitations across identities within their window and refuses the next", async () => {
    const { limits } = limitsOn()

    // Two identities fill the address's invitations: ann all of hers, bob the rest.
    expect(ADDRESS_INVITES.limit).toBeLessThanOrEqual(2 * INVITES)

    for (let attempt = 0; attempt < ADDRESS_INVITES.limit; attempt += 1) {
      expect(limits.inviteMail(attempt < INVITES ? ann : bob, '203.0.113.7')).toEqual({
        allowed: true,
      })
    }

    expect(
      limits.inviteMail(idSchemas.identity.schema.parse('idn_cat'), '203.0.113.7').allowed,
    ).toBe(false)
    // The address's mails were left: its invitations refused, not its mails.
    expect(limits.verificationMail('203.0.113.7').allowed).toBe(true)
    expect(
      limits.inviteMail(idSchemas.identity.schema.parse('idn_cat'), '203.0.113.8').allowed,
    ).toBe(true)
  })

  it("leaves the address's invitations uncharged by an invitation its identity's limit refuses", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < INVITES; attempt += 1) {
      limits.inviteMail(ann, '203.0.113.7')
    }

    for (let attempt = 0; attempt < INVITES; attempt += 1) {
      expect(limits.inviteMail(ann, '203.0.113.7').allowed).toBe(false)
    }

    // Those refusals took nothing of the address's invitations: the rest of them fit.
    for (let attempt = INVITES; attempt < ADDRESS_INVITES.limit; attempt += 1) {
      expect(limits.inviteMail(bob, '203.0.113.7')).toEqual({ allowed: true })
    }
  })

  it("takes one of the address's mails for each invitation, sign-ups and invitations together, and refuses the mail past them of either kind", async () => {
    const { clock, limits } = limitsOn()
    const rest = ADDRESS_MAILS.windowMs - 5 * minute

    answers(MAILS - INVITES, () => limits.verificationMail(FROM))

    expect(answers(INVITES, () => limits.inviteMail(ann, FROM).allowed)).toEqual(
      answers(INVITES, () => true),
    )
    await clock.advance(5 * minute)
    // The mail past them: the address's mails refuse an invitation of an identity with room left.
    expect(limits.inviteMail(bob, FROM)).toEqual({ allowed: false, retryAfterMs: rest })
    expect(limits.verificationMail(FROM)).toEqual({ allowed: false, retryAfterMs: rest })
    // Another address keeps its own mails.
    expect(limits.inviteMail(bob, ELSEWHERE)).toEqual({ allowed: true })
  })

  it('gives the address its mail back when an invitation window refuses the invitation', () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < INVITES; attempt += 1) {
      limits.inviteMail(ann, FROM)
    }

    // The identity's window refuses these 20: each gives its mail back.
    expect(answers(20, () => limits.inviteMail(ann, FROM).allowed)).toEqual(
      answers(20, () => false),
    )
    // The invitations took as many of the address's mails: the rest fit, and the next is refused.
    expect(answers(MAILS - INVITES, () => limits.verificationMail(FROM).allowed)).toEqual(
      answers(MAILS - INVITES, () => true),
    )
    expect(limits.verificationMail(FROM).allowed).toBe(false)
  })

  it("gives the address its mail back when the address's invitations refuse the invitation", () => {
    const { limits } = limitsOn()

    for (let attempt = 0; attempt < ADDRESS_INVITES.limit; attempt += 1) {
      limits.inviteMail(attempt < INVITES ? ann : bob, FROM)
    }

    expect(
      answers(
        20,
        () => limits.inviteMail(idSchemas.identity.schema.parse('idn_cat'), FROM).allowed,
      ),
    ).toEqual(answers(20, () => false))
    // The invitations took as many of the address's mails: the rest fit.
    expect(
      answers(MAILS - ADDRESS_INVITES.limit, () => limits.verificationMail(FROM).allowed),
    ).toEqual(answers(MAILS - ADDRESS_INVITES.limit, () => true))
    expect(limits.verificationMail(FROM).allowed).toBe(false)
  })

  it("moves no invitation window for an invitation the address's mails refuse", async () => {
    const { clock, limits } = limitsOn()

    answers(MAILS, () => limits.verificationMail(FROM))
    await clock.advance(ADDRESS_MAILS.windowMs - minute)

    // More refusals by the mails than ann's invitations: neither hers nor the address's are touched.
    expect(answers(INVITES + 10, () => limits.inviteMail(ann, FROM).allowed)).toEqual(
      answers(INVITES + 10, () => false),
    )
    await clock.advance(minute)
    // The mails window opened again; the invitation windows are fresh.
    const fromBob = ADDRESS_INVITES.limit - INVITES

    expect(answers(INVITES, () => limits.inviteMail(ann, FROM).allowed)).toEqual(
      answers(INVITES, () => true),
    )
    expect(answers(fromBob, () => limits.inviteMail(bob, FROM).allowed)).toEqual(
      answers(fromBob, () => true),
    )
    expect(limits.inviteMail(idSchemas.identity.schema.parse('idn_cat'), FROM).allowed).toBe(false)
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
    // The address took three of its mails: the rest fit, the refused resend's place given back.
    expect(answers(MAILS - 3, () => limits.verificationMail(FROM).allowed)).toEqual(
      answers(MAILS - 3, () => true),
    )
    expect(limits.verificationMail(FROM).allowed).toBe(false)
  })

  it("takes an address's verification mails within their window, sign-ups and resends together, and refuses the next of either kind", async () => {
    const { clock, limits } = limitsOn()
    const rest = ADDRESS_MAILS.windowMs - 5 * minute
    const mixed = answers(MAILS, (n) =>
      n % 2 === 0
        ? limits.verificationMail(FROM)
        : limits.verificationMail(FROM, `user-${n}@example.test`),
    )

    expect(mixed).toEqual(answers(MAILS, () => ({ allowed: true })))
    await clock.advance(5 * minute)
    expect(limits.verificationMail(FROM)).toEqual({ allowed: false, retryAfterMs: rest })
    expect(limits.verificationMail(FROM, 'fresh@example.test')).toEqual({
      allowed: false,
      retryAfterMs: rest,
    })
    // Another address keeps its own budget.
    expect(limits.verificationMail(ELSEWHERE)).toEqual({ allowed: true })
    expect(limits.verificationMail(ELSEWHERE, 'fresh@example.test')).toEqual({ allowed: true })
  })

  it("leaves an email's resends untouched by the resends its address's budget refuses", () => {
    const { limits } = limitsOn()

    answers(MAILS, () => limits.verificationMail(FROM))

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

  it("opens the address's and the email's windows again once both have passed", async () => {
    const { clock, limits } = limitsOn()

    answers(3, () => limits.verificationMail(FROM, 'ghost@example.test'))
    answers(MAILS - 3, () => limits.verificationMail(FROM))

    expect(limits.verificationMail(FROM).allowed).toBe(false)
    expect(limits.verificationMail(ELSEWHERE, 'ghost@example.test').allowed).toBe(false)

    await clock.advance(Math.max(ADDRESS_MAILS.windowMs, EMAIL_VERIFICATION_MAILS.windowMs))

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

describe('RequestLimits, the mails and links of a password and an email', () => {
  it('takes three reset mails of an email within 15 minutes, refuses the fourth, and the refused one costs its address nothing', async () => {
    const { clock, limits } = limitsOn()

    expect(answers(3, () => limits.resetMail(FROM, 'ann@example.test').allowed)).toEqual([
      true,
      true,
      true,
    ])
    await clock.advance(5 * minute)
    expect(limits.resetMail(FROM, 'ann@example.test')).toEqual({
      allowed: false,
      retryAfterMs: 10 * minute,
    })
    // An email's resends of its verification mail are another limit.
    expect(limits.verificationMail(FROM, 'ann@example.test')).toEqual({ allowed: true })
    // The address took four of its mails: the rest fit, the refused reset's place given back.
    expect(answers(MAILS - 4, () => limits.verificationMail(FROM).allowed)).toEqual(
      answers(MAILS - 4, () => true),
    )
    expect(limits.verificationMail(FROM).allowed).toBe(false)
    await clock.advance(10 * minute)
    expect(limits.resetMail(ELSEWHERE, 'ann@example.test')).toEqual({ allowed: true })
  })

  it("shares the address's budget of mails among sign-ups, resends, resets and email changes", () => {
    const { limits } = limitsOn()

    // The address's mails in four shares, the sign-ups taking what the others leave.
    const share = Math.floor(MAILS / 4)

    answers(MAILS - 3 * share, () => limits.verificationMail(FROM))
    answers(share, (n) => limits.verificationMail(FROM, `resend-${n}@example.test`))
    answers(share, (n) => limits.resetMail(FROM, `reset-${n}@example.test`))
    answers(share, (n) =>
      limits.emailChangeMail(FROM, idSchemas.identity.schema.parse(`idn_change_${n}`)),
    )

    expect(limits.resetMail(FROM, 'fresh@example.test').allowed).toBe(false)
    expect(limits.emailChangeMail(FROM, bob).allowed).toBe(false)
    expect(limits.verificationMail(FROM).allowed).toBe(false)
    // Neither refusal took anything of the email's or the identity's own limit.
    expect(answers(3, () => limits.resetMail(ELSEWHERE, 'fresh@example.test').allowed)).toEqual([
      true,
      true,
      true,
    ])
    expect(
      answers(IDENTITY_EMAIL_CHANGES.limit, () => limits.emailChangeMail(ELSEWHERE, bob).allowed),
    ).toEqual(answers(IDENTITY_EMAIL_CHANGES.limit, () => true))
  })

  it("takes an identity's email changes within their window and refuses the next", async () => {
    const { clock, limits } = limitsOn()
    const { limit } = IDENTITY_EMAIL_CHANGES
    const rest = IDENTITY_EMAIL_CHANGES.windowMs - minute

    expect(answers(limit, () => limits.emailChangeMail(FROM, ann).allowed)).toEqual(
      answers(limit, () => true),
    )
    await clock.advance(minute)
    expect(limits.emailChangeMail(ELSEWHERE, ann)).toEqual({
      allowed: false,
      retryAfterMs: rest,
    })
    expect(limits.emailChangeMail(FROM, bob)).toEqual({ allowed: true })
    await clock.advance(rest)
    expect(limits.emailChangeMail(FROM, ann)).toEqual({ allowed: true })
  })

  it('takes three deletion requests of an identity within 15 minutes, refuses the fourth, and the refused one costs its address nothing', async () => {
    const { clock, limits } = limitsOn()

    expect(answers(3, () => limits.deletionMail(FROM, ann).allowed)).toEqual([true, true, true])
    await clock.advance(minute)
    expect(limits.deletionMail(ELSEWHERE, ann)).toEqual({
      allowed: false,
      retryAfterMs: 14 * minute,
    })
    expect(limits.deletionMail(FROM, bob)).toEqual({ allowed: true })
    // An identity's changes of its email are another limit.
    expect(limits.emailChangeMail(FROM, ann)).toEqual({ allowed: true })
    // The refused request took none of ELSEWHERE's mails.
    expect(answers(MAILS, () => limits.verificationMail(ELSEWHERE).allowed)).toEqual(
      answers(MAILS, () => true),
    )
    await clock.advance(14 * minute)
    expect(limits.deletionMail(FROM, ann)).toEqual({ allowed: true })
  })

  it("counts the deletion mails toward the address's budget of mails", () => {
    const { limits } = limitsOn()

    answers(MAILS - 50, () => limits.verificationMail(FROM))
    answers(50, (n) =>
      limits.deletionMail(FROM, idSchemas.identity.schema.parse(`idn_deletion_${n}`)),
    )

    expect(limits.deletionMail(FROM, ann).allowed).toBe(false)
    expect(limits.verificationMail(FROM).allowed).toBe(false)
    // The refusal took nothing of the identity's own limit.
    expect(answers(3, () => limits.deletionMail(ELSEWHERE, ann).allowed)).toEqual([
      true,
      true,
      true,
    ])
  })

  it.each([
    ['passwordReset', ['emailConfirmation', 'accountDeletion', 'invitationLink']],
    ['emailConfirmation', ['passwordReset', 'accountDeletion', 'invitationLink']],
    ['accountDeletion', ['passwordReset', 'emailConfirmation', 'invitationLink']],
    ['invitationLink', ['passwordReset', 'emailConfirmation', 'accountDeletion']],
  ] as const)(
    'takes the attempts of %s per address the contract allows within their window, refused or not, apart from %j',
    async (kind, others) => {
      const { clock, limits } = limitsOn()
      const { limit } = ADDRESS_LINK_ATTEMPTS
      const rest = ADDRESS_LINK_ATTEMPTS.windowMs - 4 * minute

      expect(answers(limit, () => limits[kind](FROM).allowed)).toEqual(answers(limit, () => true))
      await clock.advance(4 * minute)
      expect(limits[kind](FROM)).toEqual({ allowed: false, retryAfterMs: rest })
      expect(limits[kind](ELSEWHERE)).toEqual({ allowed: true })

      for (const other of others) {
        expect(limits[other](FROM)).toEqual({ allowed: true })
      }

      await clock.advance(rest)
      expect(limits[kind](FROM)).toEqual({ allowed: true })
    },
  )

  it("takes no mail of the address for an attempt at an invitation's link", () => {
    const { limits } = limitsOn()

    answers(50, () => limits.invitationLink(FROM))

    expect(answers(MAILS, () => limits.verificationMail(FROM).allowed)).toEqual(
      answers(MAILS, () => true),
    )
  })
})
