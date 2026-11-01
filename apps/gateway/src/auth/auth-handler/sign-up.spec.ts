import { describe, expect, it, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { deviceHeaders } from '../__fixtures__/auth-instance'
import { hashPassword } from '../password-hash'

import {
  ANN,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  resendRequest,
  signInRequest,
  signUpRequest,
} from './__fixtures__/mount'
import { SIGN_UP_FLOOR_MS } from './sign-up'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** How long a test waits for real sign-ups to reach the floor: argon2 is slow on a busy host. */
const ARGON2_WAIT = { timeout: 10_000 }

/** How long a test of real sign-ups may run: its waits for argon2, then the floor. */
const REAL_SIGN_UPS_MS = 30_000

/** What Better Auth answers a sign-up it accepted, new email or taken. */
const accepted = () => Response.json({ token: null, user: {} })

describe('authHandler, the sign-up', () => {
  it(
    'answers a new, a taken and a concurrently taken email alike, at the floor',
    async () => {
      const { route, clock, outbox } = await mountedOnRealAuth()
      let settled = 0
      const up = (email: string) =>
        route(signUpRequest(email), FROM).finally(() => {
          settled += 1
        })
      const pending = [
        up('ann@example.test'),
        up('ann@example.test'),
        up('bob@example.test'),
        up('bob@example.test'),
      ]

      // Better Auth has answered all four (each hashes a password, slow on a busy host): only the
      // floor holds their answers back.
      await vi.waitFor(() => expect(clock.pending()).toBe(4), ARGON2_WAIT)
      expect(settled).toBe(0)
      await clock.advance(SIGN_UP_FLOOR_MS)

      const answers = await Promise.all(pending)

      for (const answer of answers) {
        expect(answer?.status).toBe(202)
        expect(await answer?.text()).toBe('')
        expect(answer?.headers.get('set-cookie')).toBeNull()
        expect([...(answer?.headers.keys() ?? [])].sort()).toEqual(
          [...(answers[0]?.headers.keys() ?? [])].sort(),
        )
      }

      const later = up('ann@example.test')

      await clock.advance(SIGN_UP_FLOOR_MS)
      expect((await later)?.status).toBe(202)
      await outbox.next('ann@example.test')
      await outbox.next('bob@example.test')
      expect(outbox.to('ann@example.test')).toHaveLength(1)
      expect(outbox.to('bob@example.test')).toHaveLength(1)
    },
    REAL_SIGN_UPS_MS,
  )

  it('answers no sooner than the floor after the request began', async () => {
    const { route, clock } = mountedOnFakeAuth(accepted)
    let settled = false
    const pending = route(signUpRequest('ann@example.test'), FROM).then((answer) => {
      settled = true

      return answer
    })

    // Better Auth has answered: only the floor holds the answer back.
    await vi.waitFor(() => expect(clock.pending()).toBe(1))
    await clock.advance(SIGN_UP_FLOOR_MS - 1)
    expect(settled).toBe(false)
    await clock.advance(1)
    expect((await pending)?.status).toBe(202)
  })

  it("takes the address's verification mails for every sign-up, whatever the email", async () => {
    const { route, clock } = mountedOnFakeAuth(accepted)

    for (let n = 0; n < 180; n += 1) {
      expect((await route(resendRequest(`r${n}@example.test`), FROM))?.status).toBe(202)
    }

    for (let n = 0; n < 20; n += 1) {
      const pending = route(signUpRequest(`s${n}@example.test`), FROM)

      await clock.advance(SIGN_UP_FLOOR_MS)
      expect((await pending)?.status).toBe(202)
    }

    await clock.advance(10_000)
    expect((await route(signUpRequest('one-more@example.test'), FROM))?.status).toBe(429)

    const elsewhere = route(signUpRequest('one-more@example.test'), ELSEWHERE)

    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await elsewhere)?.status).toBe(202)
  })

  it('refuses a body without an email, and closes no socket for any sign-up', async () => {
    const { route, closes } = mountedOnFakeAuth(accepted)

    expect(
      (
        await route(
          new Request('http://gateway.test/auth/sign-up/email', { method: 'POST', body: '{}' }),
          FROM,
        )
      )?.status,
    ).toBe(400)
    expect(closes).toEqual([])
  })
})

/** Passwords that break the rules of a new password, each by what it lacks or holds. */
const BREAKING = [
  ['nothing typed', ''],
  ['9 characters', 'Abcdefg1!'],
  ['36 characters', `Abcdefghij1!${'k'.repeat(24)}`],
  ['a space', 'Abcdefg hij1!'],
  ['an accented letter', 'Abcdefg\u00e9hij1!'],
  ['no digit', 'Abcdefghij!!'],
  ['no uppercase letter', 'abcdefghij1!'],
  ['no lowercase letter', 'ABCDEFGHIJ1!'],
  ['no symbol', 'Abcdefghij12'],
] as const

describe('authHandler, the rules of a new password', () => {
  it.each(BREAKING)(
    'refuses a password with %s at once, 400 weak-password, Better Auth not asked',
    async (_, password) => {
      const { route, clock, received } = mountedOnFakeAuth(accepted)
      const answer = await route(signUpRequest(ANN, password), FROM)

      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code: 'weak-password' })
      expect(received).toEqual([])
      // No floor holds a refusal back.
      expect(clock.pending()).toBe(0)
    },
  )

  it("refuses it without waiting for the email's turn", async () => {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const { route, clock, received } = mountedOnFakeAuth(async () => {
      await held

      return accepted()
    })
    // A sign-up of the email is under way, holding its turn.
    const first = route(signUpRequest(ANN), FROM)

    await vi.waitFor(() => expect(received).toHaveLength(1))

    const weak = await route(signUpRequest(ANN, 'pass-word-1'), FROM)

    expect(weak?.status).toBe(400)
    expect(received).toHaveLength(1)

    release()
    await vi.waitFor(() => expect(clock.pending()).toBe(1))
    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await first)?.status).toBe(202)
  })

  it('asks the directory nothing for a password that breaks a rule, and leaves the email free', async () => {
    const queries: string[] = []
    const { route, clock, outbox, sessions } = await mountedOnRealAuth({
      directory: (local) =>
        interceptQueries(local, (text) => {
          queries.push(text)
        }),
    })

    queries.splice(0)

    expect((await route(signUpRequest(ANN, 'abcdefghij'), FROM))?.status).toBe(400)
    expect(queries).toEqual([])
    expect(outbox.to(ANN)).toEqual([])
    expect((await sessions.identityOf(ANN))._unsafeUnwrap()).toBeUndefined()

    // The same email signs up once its password keeps the rules.
    const up = route(signUpRequest(ANN, 'Abcdefghij1!'), FROM)

    await vi.waitFor(() => expect(clock.pending()).toBe(1), ARGON2_WAIT)
    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await up)?.status).toBe(202)
    await outbox.next(ANN)
  })

  it.each([
    ['10', 'Abcdefgh1!'],
    ['35', `Ab1!${'c'.repeat(31)}`],
  ])(
    'accepts a password of %s characters that keeps every rule, Better Auth agreeing',
    async (_, password) => {
      const { route, clock, outbox } = await mountedOnRealAuth()
      const up = route(signUpRequest(ANN, password), FROM)

      await vi.waitFor(() => expect(clock.pending()).toBe(1), ARGON2_WAIT)
      await clock.advance(SIGN_UP_FLOOR_MS)
      expect((await up)?.status).toBe(202)
      await outbox.next(ANN)
    },
  )

  it('signs up, verifies and signs in with a password of quotes, slashes and braces, exactly as typed', async () => {
    // Each symbol a runtime could read as syntax: a backslash, a slash, both quotes, angle
    // brackets, a backtick, a dollar sign, braces and a semicolon. A password is data all the way:
    // JSON on the wire, an argon2id hash at once.
    const password = ['Ab1', '\\', '/', '"', "'", '<', '>', '`', '$', '{', '}', ';', 'x'].join('')
    const { auth, route, clock, outbox } = await mountedOnRealAuth()

    expect(password).toHaveLength(15)

    const up = route(signUpRequest(ANN, password), FROM)

    await vi.waitFor(() => expect(clock.pending()).toBe(1), ARGON2_WAIT)
    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await up)?.status).toBe(202)
    await auth.api.verifyEmail({
      query: { token: linkToken(await outbox.next(ANN)) },
      headers: deviceHeaders('laptop'),
    })

    expect((await route(signInRequest(ANN, password, 'laptop'), FROM))?.status).toBe(200)

    // The same password with one symbol swapped for another is another password.
    for (const [symbol, swapped] of [
      ['\\', '/'],
      ['"', "'"],
      ['<', '>'],
      ['$', ';'],
    ] as const) {
      const other = password.replace(symbol, swapped)

      expect(other).not.toBe(password)
      expect((await route(signInRequest(ANN, other, 'laptop'), FROM))?.status).toBe(401)
    }
  })

  it.each([
    ['8 characters', 'old-pass'],
    ['128 characters', 'p'.repeat(128)],
  ])(
    'signs an account whose password was set before the rules in, its password of %s',
    async (_, password) => {
      const { auth, route } = await mountedOnRealAuth()
      const context = await auth.$context
      const user = await context.internalAdapter.createUser<{ readonly locale: string }>({
        email: ANN,
        name: 'Ann',
        emailVerified: true,
        locale: 'en',
      })

      await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await hashPassword(password),
      })

      const answer = await route(signInRequest(ANN, password, 'laptop'), FROM)

      expect(answer?.status).toBe(200)
      expect(await answer?.json()).toMatchObject({ user: { id: user.id, email: ANN } })
    },
  )
})
