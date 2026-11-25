import { describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import { type IdentityId, profileIdFactory } from '@workspace/ids'
import { CONTRACT_ROLES } from '@workspace/kernel'

import { CREDENTIAL_CHECKS, FAILED_SIGN_INS } from '../../limits/windows'
import { linkToken } from '../../mail/__fixtures__/outbox'
import { ban, sessionStates } from '../__fixtures__/account-ban'
import { deviceHeaders } from '../__fixtures__/auth-instance'
import liveSessionsStatement from '../__fixtures__/device-sessions-live.surql'
import identityRoleSetStatement from '../__fixtures__/identity-role-set.surql'
import profileRowStatement from '../__fixtures__/profile-row.surql'
import secondFactorConfirmStatement from '../__fixtures__/second-factor-confirm.surql'
import settingsLocaleStatement from '../__fixtures__/settings-locale.surql'

import { challengeOf, challengeRows, tokenOf, withSecondFactor } from './__fixtures__/code-step'
import {
  ANN,
  ARGON2_WAIT,
  annsLink,
  heldQueries,
  holdTurn,
  isAccountLookup,
  isAdmission,
  isChallengeEnd,
  isChallengeLookup,
  isSessionInsert,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  STAND_IN_ACCOUNT,
  signedInOn,
  signInRequest,
  turnsAsked,
} from './__fixtures__/mount'
import { failAllButLastSignIn, OUT_OF_LENGTH } from './__fixtures__/out-of-length'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from. */
const FROM = '203.0.113.7'

/** An email no account has. */
const GHOST = 'ghost@example.test'

/** An account, and the email it moves to. */
const BOB = 'bob@example.test'
const MOVED = 'bob.moved@example.test'

/** An email no account has, until an account moves to it. */
const ELSEWHERE = 'elsewhere@example.test'

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The devices of `identity` whose session has not ended. */
async function liveSessions(mounted: Mounted, identity: string): Promise<unknown[]> {
  const [devices] = await mounted.local.db.query<[unknown[]]>(liveSessionsStatement, { identity })

  return devices
}

/** Moves the email of `identity` from `from` to `to` through the link of a confirmation. */
async function moved(mounted: Mounted, identity: IdentityId, from: string, to: string) {
  const token = (await mounted.emailChanges.ask(identity, from, to))._unsafeUnwrap()

  expect((await mounted.route(postTo('/auth/confirm-email', { token }), FROM))?.status).toBe(200)
}

/** `request` with `set` among its headers. */
function withHeaders(request: Request, set: Readonly<Record<string, string>>): Request {
  const headers = new Headers(request.headers)

  for (const [name, value] of Object.entries(set)) {
    headers.set(name, value)
  }

  return new Request(request, { headers })
}

/** Asks for a reset mail to `email` and answers the token of its link. */
async function resetLink(mounted: Mounted, email: string): Promise<string> {
  const seen = mounted.outbox.to(email).length
  const answer = await pastFloor(
    mounted.clock,
    mounted.route(postTo('/auth/request-password-reset', { email }), FROM),
    RESET_REQUEST_FLOOR_MS,
  )

  expect(answer?.status).toBe(202)

  return linkToken(await mounted.outbox.next(email, seen))
}

describe('authHandler, a sign-in and what runs beside it', () => {
  it('leaves no session to a sign-in of an email that moved to another account while Better Auth looked it up, a reset of that account beside it', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const bob = await signedInOn(mounted, BOB, ['laptop'])
    const change = (await mounted.emailChanges.ask(bob.identity, BOB, MOVED))._unsafeUnwrap()
    const lookup = queries.hold(isAccountLookup)
    const insert = queries.hold(isSessionInsert)
    // No account has the email yet: Bob only asked to move to it.
    const signingIn = mounted.route(signInRequest(MOVED, PASSWORD, 'phone'), FROM)

    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    expect(
      (await mounted.route(postTo('/auth/confirm-email', { token: change }), FROM))?.status,
    ).toBe(200)
    lookup.release()

    // Better Auth found Bob by the email he moved to, checked his old password, and waits to write
    // the session; a reset of Bob runs to its end meanwhile.
    await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)

    const token = await resetLink(mounted, MOVED)

    expect(
      (
        await mounted.route(
          postTo('/auth/reset-password', { token, password: 'New-pass-word-2' }),
          FROM,
        )
      )?.status,
    ).toBe(200)
    insert.release()

    const answer = await signingIn

    expect(answer?.status).toBe(401)
    expect(await answer?.json()).toEqual({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect(await liveSessions(mounted, bob.identity)).toEqual([])
    expect((await mounted.route(signInRequest(MOVED, PASSWORD, 'desk'), FROM))?.status).toBe(401)
  }, 30_000)

  it('leaves no session to a sign-in of an email that moved to an account and away again while Better Auth checked it, a reset of that account beside it', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const bob = await signedInOn(mounted, BOB, ['laptop'])
    const lookup = queries.hold(isAccountLookup)
    const insert = queries.hold(isSessionInsert)
    // No account has the email when the sign-in begins.
    const signingIn = mounted.route(signInRequest(MOVED, PASSWORD, 'phone'), FROM)

    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    await moved(mounted, bob.identity, BOB, MOVED)
    lookup.release()

    // Better Auth found Bob by the email, checked his password and waits to write the session;
    // Bob moves on to another email, and a reset of Bob there runs to its end.
    await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)
    await moved(mounted, bob.identity, MOVED, ELSEWHERE)

    const token = await resetLink(mounted, ELSEWHERE)

    expect(
      (
        await mounted.route(
          postTo('/auth/reset-password', { token, password: 'New-pass-word-2' }),
          FROM,
        )
      )?.status,
    ).toBe(200)
    insert.release()

    // The email has no account again, as when the sign-in began.
    const answer = await signingIn

    expect(answer?.status).toBe(401)
    expect(await answer?.json()).toEqual({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect(await liveSessions(mounted, bob.identity)).toEqual([])
  }, 30_000)

  it("leaves neither a session nor another account's start to a sign-in of an email that moved to another account and back", async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    // Ann holds the email; Bob has another one; neither account has started.
    const ann = await signedInOn(mounted, MOVED, ['desk'])
    const bob = await signedInOn(mounted, BOB, ['laptop'])
    const lookup = queries.hold(isAccountLookup)
    const insert = queries.hold(isSessionInsert)
    const signingIn = mounted.route(signInRequest(MOVED, PASSWORD, 'phone'), FROM)

    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    await moved(mounted, ann.identity, MOVED, ELSEWHERE)
    await moved(mounted, bob.identity, BOB, MOVED)
    lookup.release()

    // Better Auth found Bob by the email and checked his password; the email goes back to Ann
    // before the session is written.
    await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)
    await moved(mounted, bob.identity, MOVED, BOB)
    await moved(mounted, ann.identity, ELSEWHERE, MOVED)
    insert.release()

    const answer = await signingIn
    const body: unknown = await answer?.json()

    expect(answer?.status).toBe(401)
    expect(body).toEqual({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect(await liveSessions(mounted, bob.identity)).toEqual(['laptop'])
    expect(await liveSessions(mounted, ann.identity)).toEqual(['desk'])
  }, 30_000)

  it.each(OUT_OF_LENGTH)(
    "refuses %s as a wrong one of an account's length is, alike for an email that has an account and one that has none",
    async (_, password) => {
      const mounted = await mountedOnRealAuth()

      await signedInOn(mounted, ANN, ['laptop'])

      for (const email of [ANN, GHOST]) {
        const wrong = await mounted.route(signInRequest(email, 'Wrong-pass-word-9', 'desk'), FROM)
        const out = await mounted.route(signInRequest(email, password, 'desk'), FROM)

        expect([out?.status, await out?.json()]).toEqual([
          401,
          { code: 'INVALID_EMAIL_OR_PASSWORD' },
        ])
        expect(wrong?.status).toBe(401)
      }
    },
    30_000,
  )

  it.each(OUT_OF_LENGTH)(
    "answers %s as a wrong one of an account's length where the request is refused first: another origin, an email that is not one",
    async (_, password) => {
      const mounted = await mountedOnRealAuth()

      await signedInOn(mounted, ANN, ['laptop'])

      const asked = async (request: Request) => {
        const answer = await mounted.route(request, FROM)

        return [answer?.status, await answer?.json()]
      }
      const elsewhere = (request: Request): Request => {
        const headers = new Headers(request.headers)

        headers.set('origin', 'http://elsewhere.test')

        return new Request(request, { headers })
      }

      expect(await asked(elsewhere(signInRequest(ANN, password, 'desk')))).toEqual(
        await asked(elsewhere(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'))),
      )
      expect(await asked(signInRequest('not-an-email', password, 'desk'))).toEqual(
        await asked(signInRequest('not-an-email', 'Wrong-pass-word-9', 'desk')),
      )
    },
    30_000,
  )

  it.each(OUT_OF_LENGTH)(
    'counts %s among the failed sign-ins of its email, as a wrong one',
    async (_, password) => {
      const mounted = await mountedOnRealAuth()

      await signedInOn(mounted, ANN, ['laptop'])
      await failAllButLastSignIn((request, from) => mounted.route(request, from), ANN, FROM)

      expect((await mounted.route(signInRequest(ANN, password, 'desk'), FROM))?.status).toBe(401)
      // That last failure spent them: the right password waits too.
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
    },
    60_000,
  )

  it('answers a sign-in that names no password at once, for an email that has an account as for one that has none, whatever runs for them', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const asked = turnsAsked(mounted.turns)
    // Work of Ann's account holds both its turns: a reset, a change, a sign-up of her email.
    const releases = [
      await holdTurn(mounted.turns, ann.identity),
      await holdTurn(mounted.turns, ANN),
    ]

    for (const email of [ANN, GHOST]) {
      let checked = false
      const wrong = mounted
        .route(signInRequest(email, 'Wrong-pass-1', 'desk'), FROM)
        .finally(() => {
          checked = true
        })
      const malformed = await mounted.route(
        postTo('/auth/sign-in/email', { email }, { device: 'desk' }),
        FROM,
      )

      expect(malformed?.status).toBe(400)
      expect(await malformed?.json()).toEqual({ code: 'bad-request' })
      // Answered while the overlapping sign-in of the same email still checks its password.
      expect(checked).toBe(false)
      expect((await wrong)?.status).toBe(401)
    }

    // No sign-in waits for the account's work: none takes a turn.
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(200)
    expect(asked(ann.identity)).toBe(1)
    expect(asked(ANN)).toBe(1)

    for (const release of releases) {
      release()
    }
  }, 30_000)
})

describe('authHandler, the start of an account at its sign-in', () => {
  it("carries no start for an account whose profile and settings exist, and the account's answer by the allowlist", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    await mounted.local.db.query(settingsLocaleStatement, { identity: ann.identity, locale: 'en' })
    await mounted.local.db.query(profileRowStatement, {
      id: profileIdFactory.create(),
      identity: ann.identity,
      name: 'Ann',
      email: ANN,
    })

    const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)
    const body: unknown = await answer?.json()

    expect(answer?.status).toBe(200)
    expect(body).toEqual({
      token: tokenOf(body),
      user: { id: ann.identity, email: ANN, name: 'Ann', emailVerified: true },
    })
  })
})

describe('authHandler, the answer of a sign-in', () => {
  it('forwards no field outside the allowlist: the token, and the id, email, name and verified email of the account', async () => {
    const { route } = mountedOnFakeAuth(() =>
      Response.json({
        redirect: false,
        token: 'raw-token',
        url: null,
        user: {
          id: STAND_IN_ACCOUNT,
          email: ANN,
          name: 'Ann',
          emailVerified: true,
          image: 'https://example.test/MARKER-image.png',
          locale: 'en',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          role: CONTRACT_ROLES.operator,
          banned: false,
          banReason: 'MARKER reason',
          banExpires: '2026-12-01T00:00:00.000Z',
        },
      }),
    )
    const answer = await route(signInRequest(ANN, PASSWORD, 'laptop'), FROM)

    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({
      token: 'raw-token',
      user: { id: STAND_IN_ACCOUNT, email: ANN, name: 'Ann', emailVerified: true },
    })
  })

  it("answers a sign-in with the allowlist and the start alone, whatever role and ban reason the account's row holds", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    await mounted.local.db.query(identityRoleSetStatement, {
      identity: ann.identity,
      role: CONTRACT_ROLES.operator,
      reason: 'MARKER reason',
    })

    const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)
    const body: unknown = await answer?.json()

    expect(answer?.status).toBe(200)
    expect(body).toEqual({
      token: tokenOf(body),
      user: { id: ann.identity, email: ANN, name: 'Ann', emailVerified: true },
      start: { name: 'Ann', locale: 'en' },
    })
  })
})

describe('authHandler, the sign-in of a banned account', () => {
  /** Ann signed up and verified on her laptop, then banned a minute later: her account. */
  async function bannedAnn(mounted: Mounted) {
    const ann = await signedInOn(mounted, ANN, ['laptop'])

    await mounted.clock.advance(60_000)
    await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

    return ann
  }

  it("answers Better Auth's refusal of a banned account 403 account-banned, its code alone", async () => {
    const { route } = mountedOnFakeAuth(() =>
      Response.json(
        { code: 'BANNED_USER', message: 'MARKER You have been banned from this application' },
        { status: 403 },
      ),
    )
    const answer = await route(signInRequest(ANN, PASSWORD, 'laptop'), FROM)

    expect(answer?.status).toBe(403)
    expect(await answer?.json()).toEqual({ code: 'account-banned' })
  })

  it("refuses a banned account's right password 403 account-banned, before its device is looked at, and its wrong one 401 as any account's", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await bannedAnn(mounted)
    const right = await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)
    // Better Auth's ban gate runs before the gateway's session hook, which refuses a sign-in that
    // names no device 400.
    const deviceless = await mounted.route(
      postTo('/auth/sign-in/email', { email: ANN, password: PASSWORD }),
      FROM,
    )
    const wrong = await mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'phone'), FROM)

    expect([right?.status, await right?.json()]).toEqual([403, { code: 'account-banned' }])
    expect([deviceless?.status, await deviceless?.json()]).toEqual([
      403,
      { code: 'account-banned' },
    ])
    expect([wrong?.status, await wrong?.json()]).toEqual([
      401,
      { code: 'INVALID_EMAIL_OR_PASSWORD' },
    ])
    // No session was written for any of them: the laptop's, ended by the ban, is the only one.
    expect(
      (await sessionStates(mounted.local, ann.identity)).map((row) => [
        row.device,
        row.ended_reason,
      ]),
    ).toEqual([['laptop', 'banned']])
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it("answers an unverified banned account's right password as an unverified account's, 403 EMAIL_NOT_VERIFIED", async () => {
    const mounted = await mountedOnRealAuth()

    await annsLink(mounted.outbox)
    await ban(mounted.local, await mounted.annsId(), new Date(mounted.clock.now()))

    const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

    expect([answer?.status, await answer?.json()]).toEqual([403, { code: 'EMAIL_NOT_VERIFIED' }])
  })

  it("forgets the email's failed sign-ins at a banned account's right password, as at an accepted one", async () => {
    const mounted = await mountedOnRealAuth()

    await bannedAnn(mounted)

    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'phone'), FROM)

    for (let failed = 1; failed < FAILED_SIGN_INS.limit; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM))?.status).toBe(403)
    expect((await wrong())?.status).toBe(401)
    // The last failure allowed, had the refusal of the banned account not forgotten those before it.
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM))?.status).toBe(403)
  }, 60_000)

  it('answers 403 account-banned with no token to a sign-in whose account is banned while its session waits for its admission, its session ended by the ban', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const admission = queries.hold(isAdmission)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

    // Better Auth read the account unbanned and wrote the session, which waits for its admission;
    // the ban commits meanwhile, ending every session of the account, the waiting one included.
    await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)
    await mounted.clock.advance(60_000)

    const bannedAt = new Date(mounted.clock.now())

    await ban(mounted.local, ann.identity, bannedAt)
    await mounted.clock.advance(60_000)
    admission.release()

    const answer = await signingIn

    expect([answer?.status, await answer?.json()]).toEqual([403, { code: 'account-banned' }])
    expect(await liveSessions(mounted, ann.identity)).toEqual([])
    expect(
      (await sessionStates(mounted.local, ann.identity)).map(
        ({ device, pending, ended_at, ended_reason }) => [device, pending, ended_at, ended_reason],
      ),
    ).toEqual([
      ['laptop', false, bannedAt, 'banned'],
      ['phone', true, bannedAt, 'banned'],
    ])
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it('answers 403 account-banned with no token to a sign-in whose account is banned after Better Auth read it and before it wrote the session, which the admission ends banned', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const insert = queries.hold(isSessionInsert)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

    // Better Auth's ban gate read the account unbanned; the ban commits before the session is
    // written, so it ends the laptop's session only.
    await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)

    const bannedAt = new Date(mounted.clock.now())

    await ban(mounted.local, ann.identity, bannedAt)
    await mounted.clock.advance(60_000)

    const admittedAt = new Date(mounted.clock.now())

    insert.release()

    const answer = await signingIn

    expect([answer?.status, await answer?.json()]).toEqual([403, { code: 'account-banned' }])
    expect(await liveSessions(mounted, ann.identity)).toEqual([])
    expect(
      (await sessionStates(mounted.local, ann.identity)).map(
        ({ device, pending, ended_at, ended_reason }) => [device, pending, ended_at, ended_reason],
      ),
    ).toEqual([
      ['laptop', false, bannedAt, 'banned'],
      ['phone', true, admittedAt, 'banned'],
    ])
  }, 30_000)

  it('leaves to the ban a sign-in admitted before it: 200 with its token, then its session ended banned', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)
    const token = tokenOf(await answer?.json())

    expect(answer?.status).toBe(200)
    await mounted.clock.advance(60_000)

    const bannedAt = new Date(mounted.clock.now())

    await ban(mounted.local, ann.identity, bannedAt)

    expect(
      (await sessionStates(mounted.local, ann.identity))
        .filter((row) => row.token === token)
        .map(({ pending, ended_at, ended_reason }) => [pending, ended_at, ended_reason]),
    ).toEqual([[false, bannedAt, 'banned']])
    expect((await mounted.sessions.read(token)).kind).toBe('none')
  }, 30_000)
})

/**
 * Ann's right password, sent so that Better Auth refuses it 403 before it checks any password, by
 * what it refuses: the request's origin, its Fetch Metadata, its callback URL.
 */
const REFUSED_BEFORE_THE_PASSWORD = [
  [
    "an origin it does not trust, asked as a fetch's",
    'INVALID_ORIGIN',
    () =>
      withHeaders(signInRequest(ANN, PASSWORD, 'desk'), {
        origin: 'http://elsewhere.test',
        'sec-fetch-mode': 'cors',
      }),
  ],
  [
    'a cross-site navigation',
    'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
    () =>
      withHeaders(signInRequest(ANN, PASSWORD, 'desk'), {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
      }),
  ],
  [
    'a callback URL it does not trust',
    'INVALID_CALLBACK_URL',
    () =>
      postTo(
        '/auth/sign-in/email',
        { email: ANN, password: PASSWORD, callbackURL: 'http://elsewhere.test/' },
        { device: 'desk' },
      ),
  ],
] as const

describe("authHandler, a sign-in Better Auth refused before it checked the email's password", () => {
  it.each(REFUSED_BEFORE_THE_PASSWORD)(
    "keeps an email's failed sign-ins through a sign-in refused for %s: its right password was not checked, so it is no failure and no success",
    async (_, code, forged) => {
      const mounted = await mountedOnRealAuth()

      await signedInOn(mounted, ANN, ['laptop'])
      await failAllButLastSignIn((request, from) => mounted.route(request, from), ANN, FROM)

      const refused = await mounted.route(forged(), FROM)

      expect([refused?.status, await refused?.json()]).toEqual([403, { code }])
      // It was no failure: the next wrong password is the last allowed, not one past it.
      expect(
        (await mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM))?.status,
      ).toBe(401)
      // It was no success either: those failures stand, so the right password waits.
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
    },
    60_000,
  )

  it("counts a lockout from the email's first wrong password, not from a refusal before it that found no failures", async () => {
    const mounted = await mountedOnRealAuth()
    const [, , forged] = REFUSED_BEFORE_THE_PASSWORD[0]
    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM)

    await signedInOn(mounted, ANN, ['laptop'])
    expect((await mounted.route(forged(), FROM))?.status).toBe(403)

    // A second before the window from the refusal would end, the first wrong passwords come.
    await mounted.clock.advance(FAILED_SIGN_INS.windowMs - 1_000)

    for (let failed = 0; failed < FAILED_SIGN_INS.limit; failed += 1) {
      expect((await wrong())?.status).toBe(401)
    }

    // Past the window from the refusal, still within that from the first wrong password.
    await mounted.clock.advance(2_000)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
  }, 60_000)

  it("forgets the email's failed sign-ins at the right password of an account whose email is not verified, which Better Auth refuses after it checked it", async () => {
    const mounted = await mountedOnRealAuth()

    await annsLink(mounted.outbox)
    await failAllButLastSignIn((request, from) => mounted.route(request, from), ANN, FROM)

    const refused = await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    expect([refused?.status, await refused?.json()]).toEqual([403, { code: 'EMAIL_NOT_VERIFIED' }])

    // The right password was checked: as many wrong ones as are allowed reach Better Auth before the
    // limit, once the address's credential checks open again; the email's failures would not.
    await mounted.clock.advance(CREDENTIAL_CHECKS.windowMs)

    for (let failed = 0; failed < FAILED_SIGN_INS.limit; failed += 1) {
      expect(
        (await mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM))?.status,
      ).toBe(401)
    }

    expect(
      (await mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM))?.status,
    ).toBe(429)
  }, 90_000)
})

/**
 * Ann signed up and verified on her laptop, then on her phone, her second factor turned on from
 * the laptop (which replaced the laptop's session: `laptop` is its new token).
 */
async function annWithSecondFactor(mounted: Mounted) {
  const ann = await withSecondFactor(mounted)

  return {
    ...ann,
    laptop: ann.tokens.get('laptop') ?? expect.unreachable('a session of the laptop'),
    phone: ann.tokens.get('phone') ?? expect.unreachable('a session of the phone'),
  }
}

describe('authHandler, the password step of an account whose second factor is on', () => {
  it('answers the right password with a challenge alone: no token, no cookie, nothing signed in', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annWithSecondFactor(mounted)
    const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)
    const body: unknown = await answer?.json()

    expect(answer?.status).toBe(200)
    expect(body).toEqual({ secondFactor: { challenge: challengeOf(body) } })
    expect(answer?.headers.get('set-cookie')).toBeNull()
    expect(answer?.headers.get('set-auth-token')).toBeNull()
    // Better Auth keeps the challenge, and the row counting its codes, until a code comes.
    expect(await challengeRows(mounted)).toHaveLength(2)
    expect((await liveSessions(mounted, ann.identity)).sort()).toEqual(['laptop', 'phone'])
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it("neither counts the right password among the email's failed sign-ins nor forgets them", async () => {
    const mounted = await mountedOnRealAuth()

    await annWithSecondFactor(mounted)

    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM)
    const right = () => mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    for (let failed = 1; failed < FAILED_SIGN_INS.limit; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    expect((await right())?.status).toBe(200)
    // The last failure allowed: the right password counted none.
    expect((await wrong())?.status).toBe(401)
    // And it forgot none: they keep the right password out.
    expect((await right())?.status).toBe(429)
  }, 60_000)

  it('keeps the session of a device already signed in to the account through the password step', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annWithSecondFactor(mounted)

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(200)

    expect((await mounted.sessions.read(ann.laptop)).kind).toBe('session')
    expect((await liveSessions(mounted, ann.identity)).sort()).toEqual(['laptop', 'phone'])
  }, 30_000)

  it("leaves the session Better Auth writes and deletes at the step ended and waiting, and the asking device's earlier session live", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annWithSecondFactor(mounted)

    // The phone signed in before; its password step now meets the second factor.
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM))?.status).toBe(200)

    const phone = (await sessionStates(mounted.local, ann.identity)).filter(
      (row) => row.device === 'phone',
    )

    const [earlier, provisional, ...more] = phone

    expect(more).toEqual([])
    expect([earlier?.token, earlier?.pending, earlier?.ended_at]).toEqual([
      ann.phone,
      false,
      undefined,
    ])
    expect(provisional?.token).not.toBe(ann.phone)
    expect([provisional?.pending, provisional?.ended_reason]).toEqual([true, undefined])
    expect(provisional?.ended_at).toBeInstanceOf(Date)
    expect((await mounted.sessions.read(ann.phone)).kind).toBe('session')
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it("answers 401 to a password step whose password changed between Better Auth's answer and the second read, its challenge gone", async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annWithSecondFactor(mounted)
    const lookup = queries.hold(isChallengeLookup)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    // Better Auth checked the password and answered with its challenge; the laptop changes the
    // password before the gateway reads the account again.
    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    expect(
      (
        await mounted.route(
          postTo(
            '/auth/change-password',
            { currentPassword: PASSWORD, password: 'New-pass-word-2' },
            { device: 'laptop', token: ann.laptop },
          ),
          FROM,
        )
      )?.status,
    ).toBe(204)
    lookup.release()

    const answer = await signingIn

    expect([answer?.status, await answer?.json()]).toEqual([
      401,
      { code: 'INVALID_EMAIL_OR_PASSWORD' },
    ])
    expect(await challengeRows(mounted)).toEqual([])
  }, 30_000)

  it("answers 403 account-banned to a password step whose account was banned between Better Auth's answer and the second read, its challenge gone and its failed sign-ins kept", async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annWithSecondFactor(mounted)
    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM)

    for (let failed = 1; failed < FAILED_SIGN_INS.limit; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    const lookup = queries.hold(isChallengeLookup)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))
    lookup.release()

    const answer = await signingIn

    expect([answer?.status, await answer?.json()]).toEqual([403, { code: 'account-banned' }])
    expect(await challengeRows(mounted)).toEqual([])
    // The refusal judged nothing: the next wrong password is the last allowed, which spends them.
    expect((await wrong())?.status).toBe(401)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
  }, 60_000)
})

describe('authHandler, the judgement of a password step that met the second factor', () => {
  it("keeps the email's failed sign-ins when the account its step found banned is deleted before the step is judged", async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annWithSecondFactor(mounted)
    // A deletion link mailed to the account before the sign-in.
    const link = (await mounted.accountDeletions.ask(ann.identity))._unsafeUnwrap()
    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM)

    for (let failed = 1; failed < FAILED_SIGN_INS.limit; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    const lookup = queries.hold(isChallengeLookup)
    const ending = queries.hold(isChallengeEnd)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    // Better Auth answered with its challenge; the ban commits before the gateway reads the
    // account again.
    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))
    lookup.release()

    // The second read found the account banned; while the challenge is ended, before the step is
    // judged, the account is deleted by its link.
    await vi.waitFor(() => expect(ending.paused()).toBe(true), ARGON2_WAIT)
    expect(
      (await mounted.route(postTo('/auth/delete-account', { token: link }), FROM))?.status,
    ).toBe(200)
    ending.release()

    const answer = await signingIn

    expect([answer?.status, await answer?.json()]).toEqual([403, { code: 'account-banned' }])
    // The refusal judged nothing, though the email has no account any more: the next wrong
    // password is the last allowed, which spends them.
    expect((await wrong())?.status).toBe(401)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
  }, 60_000)
})

describe('authHandler, the password step of a banned account whose second factor is on', () => {
  it("forgets none of the email's failed sign-ins at its right password, refused 403 account-banned", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annWithSecondFactor(mounted)

    await mounted.clock.advance(60_000)
    await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM)
    const right = () => mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    for (let failed = 1; failed < FAILED_SIGN_INS.limit; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    const refused = await right()

    expect([refused?.status, await refused?.json()]).toEqual([403, { code: 'account-banned' }])
    expect(await challengeRows(mounted)).toEqual([])
    expect((await wrong())?.status).toBe(401)
    // The failures allowed stand: the refusal of the banned account forgot none of them.
    expect((await right())?.status).toBe(429)
  }, 60_000)

  it('reads whether the second factor is on when the refusal is judged: one confirmed after the first read of the account forgets nothing', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const headers = deviceHeaders('laptop')

    headers.set('authorization', `Bearer ${ann.tokens.get('laptop') ?? ''}`)
    // The key is made but not confirmed yet: the second factor is off.
    await mounted.auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers })
    await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

    const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'desk'), FROM)

    for (let failed = 1; failed < FAILED_SIGN_INS.limit; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    // The gateway read the account with the factor off; Better Auth looks it up once the code of
    // the key was confirmed.
    const lookup = queries.hold(isAccountLookup)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

    await vi.waitFor(() => expect(lookup.paused()).toBe(true), ARGON2_WAIT)
    await mounted.local.db.query(secondFactorConfirmStatement, { identity: ann.identity })
    lookup.release()

    const refused = await signingIn

    expect([refused?.status, await refused?.json()]).toEqual([403, { code: 'account-banned' }])
    expect((await wrong())?.status).toBe(401)
    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
  }, 60_000)
})
