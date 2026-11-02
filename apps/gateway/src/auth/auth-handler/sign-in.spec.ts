import { describe, expect, it, vi } from 'vitest'

import { type IdentityId, profileIdFactory } from '@workspace/ids'

import { linkToken } from '../../mail/__fixtures__/outbox'
import liveSessionsStatement from '../__fixtures__/device-sessions-live.surql'
import profileRowStatement from '../__fixtures__/profile-row.surql'
import settingsLocaleStatement from '../__fixtures__/settings-locale.surql'

import {
  ANN,
  ARGON2_WAIT,
  heldQueries,
  holdTurn,
  isAccountLookup,
  isSessionInsert,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
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
    ).toBe(204)
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
    ).toBe(204)
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
  it("carries no start for an account whose profile and settings exist, and the account's own answer as Better Auth gave it", async () => {
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
    expect(body).toMatchObject({ user: { id: ann.identity, email: ANN } })
    expect(body).not.toHaveProperty('start')
  })
})
