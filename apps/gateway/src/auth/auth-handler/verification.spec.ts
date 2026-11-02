import { signJWT } from 'better-auth/crypto'
import { describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import { z } from '@workspace/zod'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { SUPERSEDED } from '../../sync/sync-connection'
import { AUTH_SECRET, deviceHeaders } from '../__fixtures__/auth-instance'
import deviceSessionDevicesStatement from '../__fixtures__/device-session-devices.surql'

import {
  ANN,
  annsLink,
  fakeConnection,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  ORIGIN,
  pastFloor,
  postTo,
  printedDuring,
  READBACK_FAILURE,
  resendRequest,
} from './__fixtures__/mount'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** An email no account has. */
const GHOST = 'ghost@example.test'

/** Better Auth's floor for a resend without a session: no answer comes sooner. */
const RESEND_FLOOR_MS = 500

/** How early a resend may be measured against the floor: a timer's wake and the clock's rounding. */
const RESEND_FLOOR_SLACK_MS = 10

/** A verification of the link's `token` from `device` (none names no device), as the web sends it. */
function verify(token: string, device: string | null): Request {
  const headers = device === null ? new Headers({ origin: ORIGIN }) : deviceHeaders(device)

  headers.set('content-type', 'application/json')

  return new Request('http://gateway.test/auth/verify-email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token }),
  })
}

/** What the first verification of an account answers. */
const verifiedAnswer = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string(), email: z.string(), name: z.string(), locale: z.string() }),
})

/** The instant, in seconds, a link's token was signed at. */
function issuedAt(token: string): number {
  const [, payload] = token.split('.')

  return z
    .object({ iat: z.number() })
    .parse(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))).iat
}

/** An answer as a client sees it: its status, its headers and its body. */
async function seen(answer: Response | undefined) {
  return {
    status: answer?.status,
    headers: [...(answer?.headers ?? [])],
    body: (await answer?.text()) ?? '',
  }
}

describe('authHandler, the verification of an email', () => {
  it('signs the device in the first time, closing its sockets first, and answers the account', async () => {
    const { route, outbox, closes } = await mountedOnRealAuth()
    const token = await annsLink(outbox)
    const answer = await route(verify(token, 'phone'), FROM)
    const body = verifiedAnswer.parse(await answer?.json())

    expect(answer?.status).toBe(200)
    expect(body.token).not.toContain('.')
    expect(body.user).toMatchObject({ email: ANN, name: 'Ann', locale: 'en' })
    expect(closes).toEqual([[body.user.id, 'phone', SUPERSEDED]])
    expect(answer?.headers.get('set-cookie')).toBeNull()
    expect(answer?.headers.get('set-auth-token')).toBeNull()
  })

  it('answers token null for a link opened again, and signs nothing in', async () => {
    const { route, outbox, closes } = await mountedOnRealAuth()
    const token = await annsLink(outbox)

    await route(verify(token, 'phone'), FROM)

    const again = await route(verify(token, 'tablet'), FROM)

    expect(again?.status).toBe(200)
    expect(await again?.json()).toEqual({ token: null })
    expect(closes).toHaveLength(1)
  })

  it('signs exactly one device in when one link is opened on two at once', async () => {
    const { route, outbox, local } = await mountedOnRealAuth()
    const token = await annsLink(outbox)
    const answers = await Promise.all([
      route(verify(token, 'phone'), FROM),
      route(verify(token, 'tablet'), FROM),
    ])
    const bodies = z
      .array(z.object({ token: z.string().nullable() }))
      .parse(await Promise.all(answers.map(async (answer) => answer?.json())))
    const [devices] = await local.db.query<[{ device: string }[]]>(deviceSessionDevicesStatement)

    expect(bodies.filter((body) => typeof body.token === 'string')).toHaveLength(1)
    expect(bodies.filter((body) => body.token === null)).toHaveLength(1)
    // The sign-up signed nothing in: the one session is the verifying device's.
    expect(devices).toHaveLength(1)
  })

  it('signs exactly one device in when two links of one account are opened at once', async () => {
    const { route, outbox, local, auth } = await mountedOnRealAuth()
    const first = await annsLink(outbox)

    // A token is signed to the second: the second link (a resend's, after the sign-up's) differs
    // from the first once a second passed.
    await vi.waitFor(
      () => expect(Date.now()).toBeGreaterThanOrEqual((issuedAt(first) + 1) * 1000),
      {
        timeout: 2_000,
      },
    )
    await auth.api.sendVerificationEmail({ body: { email: ANN }, headers: deviceHeaders('laptop') })

    const second = linkToken(await outbox.next(ANN, 1))

    expect(second).not.toBe(first)

    const answers = await Promise.all([
      route(verify(first, 'phone'), FROM),
      route(verify(second, 'tablet'), FROM),
    ])
    const bodies = z
      .array(z.object({ token: z.string().nullable() }))
      .parse(await Promise.all(answers.map(async (answer) => answer?.json())))
    const [devices] = await local.db.query<[{ device: string }[]]>(deviceSessionDevicesStatement)

    expect(bodies.filter((body) => typeof body.token === 'string')).toHaveLength(1)
    expect(devices).toHaveLength(1)
  })

  it("closes the device's sockets even when the session cannot be read back", async () => {
    const { route, outbox, registry, annsId } = await mountedOnRealAuth({ readbackFails: true })
    const token = await annsLink(outbox)
    const phone = fakeConnection()
    const before = registry.epoch()

    registry.add(await annsId(), 'phone', phone, before)

    const { result: answer, printed } = await printedDuring(() =>
      route(verify(token, 'phone'), FROM),
    )

    expect(answer?.status).toBe(500)
    expect(await answer?.json()).toEqual({ code: 'internal' })
    expect(phone.ended).toEqual([SUPERSEDED])
    expect(registry.epoch()).toBeGreaterThan(before)
    expect(printed).not.toContain(READBACK_FAILURE)
  })

  it('answers a link it cannot read, one past its lifetime and one of no account 401 with its code alone', async () => {
    const { route, closes } = await mountedOnRealAuth()
    const expired = await signJWT({ email: ANN }, AUTH_SECRET, -10)
    const ghost = await signJWT({ email: GHOST }, AUTH_SECRET, 3600)
    const invalid = await seen(await route(verify('not-a-token', 'phone'), FROM))
    const late = await seen(await route(verify(expired, 'phone'), FROM))
    const unknown = await seen(await route(verify(ghost, 'phone'), FROM))

    expect([invalid.status, JSON.parse(invalid.body)]).toEqual([401, { code: 'link-invalid' }])
    expect([late.status, JSON.parse(late.body)]).toEqual([401, { code: 'link-expired' }])
    // A link of no account answers as a link that is no link at all.
    expect(unknown).toEqual(invalid)
    expect(closes).toEqual([])
  })

  it('answers a verification that names no device, or no token, 400 without asking Better Auth', async () => {
    const { route, received } = mountedOnFakeAuth(() => Response.json({ status: true, user: null }))
    const tokenless = verify('', 'phone')

    for (const request of [verify('a-token', null), tokenless]) {
      const answer = await route(request, FROM)

      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code: 'bad-request' })
    }

    expect(received).toHaveLength(0)
  })

  it("hands Better Auth the token alone, by GET at its public path, without the request's credentials or callback", async () => {
    const { route, received } = mountedOnFakeAuth(() => Response.json({ status: true, user: null }))
    const headers = deviceHeaders('phone')

    headers.set('content-type', 'application/json')
    headers.set('authorization', 'Bearer a-session-token')
    headers.set('cookie', 'better-auth.session_token=signed')

    const answer = await route(
      new Request('http://gateway.test/auth/verify-email?callbackURL=https://evil.test', {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: 'a.link.token' }),
      }),
      FROM,
    )

    expect(await answer?.json()).toEqual({ token: null })

    const [handed] = received

    expect(received).toHaveLength(1)
    expect(handed?.method).toBe('GET')
    expect(handed?.url).toBe('http://gateway.test/backend/auth/verify-email?token=a.link.token')
    expect(handed?.headers.has('authorization')).toBe(false)
    expect(handed?.headers.has('cookie')).toBe(false)
    expect(handed?.headers.get('x-perch-device')).toBe('phone')
    expect(handed?.headers.get('origin')).toBe(ORIGIN)
  })

  it("takes one of its address's 20 credential checks per verification: the 21st within 10 s answers 429", async () => {
    const { route, received } = mountedOnFakeAuth(() =>
      Response.json({ code: 'INVALID_TOKEN' }, { status: 401 }),
    )
    const statuses: number[] = []

    for (let n = 0; n < 20; n += 1) {
      statuses.push((await route(verify('not-a-token', 'phone'), FROM))?.status ?? 0)
    }

    const refused = await route(verify('not-a-token', 'phone'), FROM)

    expect(statuses).toEqual(Array.from({ length: 20 }, () => 401))
    expect(refused?.status).toBe(429)
    expect(await refused?.json()).toEqual({ code: 'rate-limited' })
    expect(refused?.headers.get('Retry-After')).toBe('10')
    expect(received).toHaveLength(20)
  })
})

describe('authHandler, the resend of the verification mail', () => {
  it('answers 202 with an empty body alike for an unverified, a verified and an unknown email, and mails only the unverified', async () => {
    const { route, outbox } = await mountedOnRealAuth()
    // Each sign-up mails its own link: Bob's, which he opens, and Ann's, which she does not.
    const bobs = await annsLink(outbox, 'bob@example.test')

    expect((await route(verify(bobs, 'desk'), FROM))?.status).toBe(200)
    await annsLink(outbox)

    const answers = []
    const elapsed: number[] = []

    for (const email of ['bob@example.test', GHOST, ANN]) {
      const began = performance.now()
      const answer = await route(resendRequest(email), FROM)

      elapsed.push(performance.now() - began)
      answers.push(await seen(answer))
    }

    expect(answers[0]).toEqual({ status: 202, headers: [], body: '' })
    expect(answers).toEqual([answers[0], answers[0], answers[0]])

    // No resend answers before Better Auth's floor of 500 ms, whatever the email. The floor is
    // reckoned in whole milliseconds of the wall clock and waited out by a one-shot timer, which
    // may wake a millisecond or so early, so the check allows 10 ms: without the floor a resend
    // answers within a few milliseconds, far below it.
    for (const time of elapsed) {
      expect(time).toBeGreaterThanOrEqual(RESEND_FLOOR_MS - RESEND_FLOOR_SLACK_MS)
    }

    // Ann's link once from her sign-up and once from this resend; Bob's from his sign-up alone.
    await outbox.next(ANN, 1)
    expect(outbox.to('bob@example.test')).toHaveLength(1)
    expect(outbox.to(GHOST)).toHaveLength(0)
  })

  it("answers an email's fourth resend within 15 minutes 429, the first three 202", async () => {
    const { route, received } = mountedOnFakeAuth(() => Response.json({ status: true }))
    const statuses: number[] = []

    for (let n = 0; n < 4; n += 1) {
      statuses.push((await route(resendRequest(GHOST), FROM))?.status ?? 0)
    }

    expect(statuses).toEqual([202, 202, 202, 429])
    expect(received).toHaveLength(3)
  })

  it("hands Better Auth the email alone, by POST at its public path, without the request's credentials", async () => {
    const { route, received } = mountedOnFakeAuth(() => Response.json({ status: true }))
    const request = resendRequest(ANN)

    request.headers.set('authorization', 'Bearer a-session-token')
    request.headers.set('cookie', 'better-auth.session_token=signed')

    const sent = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ email: ANN, callbackURL: 'https://evil.test' }),
    })

    expect((await route(sent, FROM))?.status).toBe(202)

    const [handed] = received

    expect(handed?.method).toBe('POST')
    expect(handed?.url).toBe('http://gateway.test/backend/auth/send-verification-email')
    expect(await handed?.text()).toBe('{"email":"ann@example.test"}')
    expect(handed?.headers.get('content-type')).toBe('application/json')
    expect(handed?.headers.has('authorization')).toBe(false)
    expect(handed?.headers.has('cookie')).toBe(false)
  })

  it('answers a resend whose body names no email 400 without asking Better Auth', async () => {
    const { route, received } = mountedOnFakeAuth(() => Response.json({ status: true }))

    for (const body of ['{}', '{"email":""}', '{"email":["ann@example.test"]}', 'not json']) {
      const answer = await route(
        new Request('http://gateway.test/auth/send-verification-email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
        FROM,
      )

      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code: 'bad-request' })
    }

    expect(received).toHaveLength(0)
  })
})

describe("authHandler, Better Auth's refusals", () => {
  /** A request of each path the mount serves, each naming Ann. */
  const requests = (): Request[] => [
    new Request('http://gateway.test/auth/sign-up/email', {
      method: 'POST',
      headers: deviceHeaders('laptop'),
      body: JSON.stringify({ name: 'Ann', email: ANN, password: 'Pass-word-1' }),
    }),
    new Request('http://gateway.test/auth/sign-in/email', {
      method: 'POST',
      headers: deviceHeaders('laptop'),
      body: JSON.stringify({ email: ANN, password: 'Pass-word-1' }),
    }),
    verify('a.link.token', 'phone'),
    resendRequest(ANN),
  ]

  it('passes a refusal on as its code alone, and a failure as internal, on every path', async () => {
    const refusal = mountedOnFakeAuth(() => {
      const headers = new Headers({ 'set-cookie': 'better-auth.session_token=signed' })

      return Response.json(
        { code: 'SOME_CODE', message: 'MARKER ann@example.test' },
        { status: 400, headers },
      )
    })
    const failure = mountedOnFakeAuth(
      () => new Response('MARKER ann@example.test failed', { status: 500 }),
    )

    for (const request of requests()) {
      expect(await seen(await refusal.route(request, FROM))).toEqual({
        status: 400,
        headers: [['content-type', 'application/json;charset=utf-8']],
        body: '{"code":"SOME_CODE"}',
      })
    }

    for (const request of requests()) {
      expect(await seen(await failure.route(request, FROM))).toEqual({
        status: 500,
        headers: [['content-type', 'application/json;charset=utf-8']],
        body: '{"code":"internal"}',
      })
    }
  })
})

describe('authHandler over Better Auth: nothing of an address or a link on stderr, in a log or in an answer', () => {
  /** An address that marks every place it could reach. */
  const MARKED = 'marker-ann@example.test'
  const MARKER = /MARKER|marker-ann/i

  it('verifies, refuses and resends with no address or link printed, logged or answered', async () => {
    const { route, outbox, logs } = await mountedOnRealAuth()
    const token = await annsLink(outbox, MARKED)
    const expired = await signJWT({ email: MARKED }, AUTH_SECRET, -10)
    const { result, printed } = await printedDuring(async () => {
      const first = await seen(await route(verify(token, 'phone'), FROM))
      const others = [
        await seen(await route(verify(token, 'tablet'), FROM)),
        await seen(await route(verify(expired, 'tablet'), FROM)),
        await seen(await route(verify(`${token}x`, 'tablet'), FROM)),
        await seen(await route(resendRequest(MARKED), FROM)),
        await seen(await route(resendRequest('marker-nobody@example.test'), FROM)),
      ]

      return { first, others }
    })

    expect(result.first.status).toBe(200)
    // The account's own email is the first verification's to answer; its link is not.
    expect(result.first.body).not.toContain(token)
    expect(JSON.stringify(result.others)).not.toMatch(MARKER)
    expect(JSON.stringify(result.others)).not.toContain(token.slice(0, 40))
    expect(printed).not.toMatch(MARKER)
    expect(printed).not.toContain(token.slice(0, 40))
    expect(JSON.stringify(logs)).not.toMatch(MARKER)
    expect(JSON.stringify(logs)).not.toContain(token.slice(0, 40))
  })

  it('answers a verification whose session cannot be created 500 internal, and logs its code alone', async () => {
    const failure: { pattern?: RegExp } = {}
    const { route, outbox, logs, closes } = await mountedOnRealAuth({
      directory: (local) =>
        interceptQueries(local, (text) => {
          if (failure.pattern?.test(text)) {
            throw new Error(`MARKER the directory failed for ${MARKED} with tok_MARKER_0123`)
          }
        }),
    })
    const token = await annsLink(outbox, MARKED)

    failure.pattern = /\bINSERT\s+INTO\s+`?device_session`?/

    const { result, printed } = await printedDuring(async () =>
      seen(await route(verify(token, 'phone'), FROM)),
    )

    expect(result).toEqual({
      status: 500,
      headers: [['content-type', 'application/json;charset=utf-8']],
      body: '{"code":"internal"}',
    })
    expect(closes).toEqual([])
    expect(logs.map(({ code }) => code)).toEqual(['auth:UNEXPECTED'])
    expect(JSON.stringify(logs)).not.toMatch(MARKER)
    expect(printed).not.toMatch(MARKER)
    expect(printed).not.toContain(token.slice(0, 40))
  })
})

describe('authHandler, a verification link after a reset verified the email', () => {
  it('answers verified-before, signs nothing in and creates no session', async () => {
    const { route, outbox, local, clock } = await mountedOnRealAuth()
    const token = await annsLink(outbox)

    await pastFloor(
      clock,
      route(postTo('/auth/request-password-reset', { email: ANN }), FROM),
      RESET_REQUEST_FLOOR_MS,
    )

    const link = linkToken(await outbox.next(ANN, 1))

    expect(
      (
        await route(
          postTo('/auth/reset-password', { token: link, password: 'New-pass-word-2' }),
          FROM,
        )
      )?.status,
    ).toBe(204)

    const answer = await route(verify(token, 'phone'), FROM)
    const [devices] = await local.db.query<[unknown[]]>(deviceSessionDevicesStatement)

    expect(answer?.status).toBe(200)
    expect(await answer?.json()).toEqual({ token: null })
    expect(devices).toEqual([])
  })
})
