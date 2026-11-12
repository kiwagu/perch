import { describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import { type IdentityId, profileIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { ban, sessionStates } from '../__fixtures__/account-ban'
import liveSessionsStatement from '../__fixtures__/device-sessions-live.surql'
import identityRoleSetStatement from '../__fixtures__/identity-role-set.surql'
import profileRowStatement from '../__fixtures__/profile-row.surql'
import settingsLocaleStatement from '../__fixtures__/settings-locale.surql'

import {
  ANN,
  ARGON2_WAIT,
  annsLink,
  heldQueries,
  holdTurn,
  isAccountLookup,
  isAdmission,
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

/** The session token a sign-in answered with: a raw token, which no test can know beforehand. */
const tokenOf = (body: unknown): string => z.object({ token: z.string().min(1) }).parse(body).token

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

  it('answers an empty password alike for an email that has an account and one that has none, before anything is read', async () => {
    const queries: string[] = []
    const mounted = await mountedOnRealAuth({
      directory: (local) =>
        interceptQueries(local, (text) => {
          queries.push(text)
        }),
    })

    await signedInOn(mounted, ANN, ['laptop'])
    queries.splice(0)

    const answers = await Promise.all(
      [ANN, GHOST].map((email) =>
        mounted.route(
          postTo('/auth/sign-in/email', { email, password: '' }, { device: 'desk' }),
          FROM,
        ),
      ),
    )

    for (const answer of answers) {
      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code: 'bad-request' })
    }

    // Better Auth was not asked: it reads the email's account first.
    expect(queries).toEqual([])
  })

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
          role: 'operator',
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
      role: 'operator',
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

    for (let failed = 0; failed < 9; failed++) {
      expect((await wrong())?.status).toBe(401)
    }

    expect((await mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM))?.status).toBe(403)
    expect((await wrong())?.status).toBe(401)
    // Ten failures, had the refusal of the banned account not forgotten the nine before it.
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
