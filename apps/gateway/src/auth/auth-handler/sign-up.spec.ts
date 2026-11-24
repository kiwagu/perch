import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import { CONTRACT_VALUES, PASSWORD_LENGTH } from '@workspace/kernel'

import { passwordOfLength } from '../../__fixtures__/platform-values'
import { linkToken } from '../../mail/__fixtures__/outbox'
import { STARTING_LANGUAGE_BUDGET_MS } from '../../tenants/invited-language'
import invitationsToEmailStatement from '../../tenants/surql/invitations-to-email.surql'
import { betterAuthToken, deviceHeaders } from '../__fixtures__/auth-instance'
import { hashPassword } from '../password-hash'
import type { StartingLanguage } from '../starting-language.port'

import {
  ANN,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  ORIGIN,
  PASSWORD,
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

/** The most characters a profile's name has, as the contract says it. */
const { maxLength: MAX_NAME } = CONTRACT_VALUES['profile.name']

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
  ['one character short of the length', passwordOfLength(PASSWORD_LENGTH.min - 1)],
  ['one character past the length', passwordOfLength(PASSWORD_LENGTH.max + 1)],
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
    ['the fewest', passwordOfLength(PASSWORD_LENGTH.min)],
    ['the most', passwordOfLength(PASSWORD_LENGTH.max)],
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
      query: { token: betterAuthToken(linkToken(await outbox.next(ANN))) },
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
})

/** Names that break the rule of a profile's name, each by what it lacks or holds, with the code that says it. */
const REFUSED_NAMES = [
  ['nothing typed', '', 'name-required'],
  ['spaces alone', '   ', 'name-required'],
  ['one character past the limit', 'r'.repeat(MAX_NAME + 1), 'name-too-long'],
  ['one character past the limit once trimmed', ` ${'r'.repeat(MAX_NAME + 1)} `, 'name-too-long'],
] as const

describe('authHandler, the name of a sign-up', () => {
  it.each(REFUSED_NAMES)(
    'refuses a name of %s at once, 400 %s, Better Auth not asked',
    async (_, name, code) => {
      const { route, clock, received } = mountedOnFakeAuth(accepted)
      const answer = await route(signUpRequest(ANN, PASSWORD, name), FROM)

      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code })
      expect(received).toEqual([])
      // No floor holds a refusal back.
      expect(clock.pending()).toBe(0)
    },
  )

  it('takes a name of the limit once trimmed', async () => {
    const { route, clock, received } = mountedOnFakeAuth(accepted)
    const pending = route(signUpRequest(ANN, PASSWORD, ` ${'r'.repeat(MAX_NAME)} `), FROM)

    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await pending)?.status).toBe(202)
    expect(received).toHaveLength(1)
  })

  it.each([
    ['no name', { email: ANN, password: PASSWORD }],
    ['a name that is no text', { name: 7, email: ANN, password: PASSWORD }],
  ])('answers 400 bad-request to a body with %s, Better Auth not asked', async (_, body) => {
    const { route, received } = mountedOnFakeAuth(accepted)
    const answer = await route(
      new Request('http://gateway.test/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      FROM,
    )

    expect(answer?.status).toBe(400)
    expect(await answer?.json()).toEqual({ code: 'bad-request' })
    expect(received).toEqual([])
  })

  it('refuses a name alike for an email that has an account and one that has none, mailing nothing', async () => {
    const { route, clock, outbox } = await mountedOnRealAuth()
    const up = route(signUpRequest(ANN), FROM)

    await vi.waitFor(() => expect(clock.pending()).toBe(1), ARGON2_WAIT)
    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await up)?.status).toBe(202)
    await outbox.next(ANN)

    const [taken, free] = await Promise.all(
      [ANN, 'bob@example.test'].map((email) => route(signUpRequest(email, PASSWORD, ''), FROM)),
    )

    for (const answer of [taken, free]) {
      expect(answer?.status).toBe(400)
      expect(await answer?.json()).toEqual({ code: 'name-required' })
      expect([...(answer?.headers.keys() ?? [])].sort()).toEqual(
        [...(taken?.headers.keys() ?? [])].sort(),
      )
    }

    expect(outbox.to(ANN)).toHaveLength(1)
    expect(outbox.to('bob@example.test')).toEqual([])
  })
})

/** A sign-up of `email` sent in `locale` (none: no language sent) from `origin`. */
function signUpIn(locale: string | undefined, email = ANN, origin = ORIGIN): Request {
  return new Request('http://gateway.test/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({
      name: 'Ann',
      email,
      password: PASSWORD,
      ...(locale === undefined ? {} : { locale }),
    }),
  })
}

/** The starting language `real` looks up, counting its lookups. */
function counted(real: StartingLanguage) {
  const asked: string[] = []

  return {
    asked,
    wrap: (): StartingLanguage => ({
      of: (email) => {
        asked.push(email)

        return real.of(email)
      },
    }),
  }
}

describe('authHandler, the starting language of a sign-up', () => {
  /** Answers `request` once the gateway's clock passed the floor of a sign-up Better Auth took. */
  async function atFloor(
    mounted: Awaited<ReturnType<typeof mountedOnRealAuth>>,
    request: Request,
  ): Promise<Response | undefined> {
    const pending = mounted.route(request, FROM)

    await vi.waitFor(() => expect(mounted.clock.pending()).toBe(1), ARGON2_WAIT)
    await mounted.clock.advance(SIGN_UP_FLOOR_MS)

    return pending
  }

  it(
    "starts an account an organisation invited in that organisation's language, whatever it was sent in",
    async () => {
      const mounted = await mountedOnRealAuth()

      await mounted.invitedTo({ key: 'acme', email: ANN, locale: 'es' })

      expect((await atFloor(mounted, signUpIn('en')))?.status).toBe(202)
      expect(await mounted.localeOf(ANN)).toBe('es')
    },
    REAL_SIGN_UPS_MS,
  )

  it(
    'keeps the language a sign-up was sent in when no organisation names one, and English when it sent none',
    async () => {
      const mounted = await mountedOnRealAuth()

      await mounted.invitedTo({ key: 'acme', email: 'bob@example.test' })

      expect((await atFloor(mounted, signUpIn('es')))?.status).toBe(202)
      expect((await atFloor(mounted, signUpIn(undefined, 'bob@example.test')))?.status).toBe(202)
      expect(await mounted.localeOf(ANN)).toBe('es')
      expect(await mounted.localeOf('bob@example.test')).toBe('en')
    },
    REAL_SIGN_UPS_MS,
  )

  it('looks nothing up for a language the app does not speak, which is refused as before', async () => {
    let lookups: ReturnType<typeof counted> | undefined
    const mounted = await mountedOnRealAuth({
      startingLanguage: (real) => {
        lookups = counted(real)

        return lookups.wrap()
      },
    })

    await mounted.invitedTo({ key: 'acme', email: ANN, locale: 'es' })

    const answer = await mounted.route(signUpIn('fr'), FROM)

    expect(answer?.status).toBe(400)
    expect(lookups?.asked).toEqual([])
    expect(await mounted.localeOf(ANN)).toBeUndefined()
  })

  it(
    'finds the invitation of an email typed in mixed case',
    async () => {
      const mounted = await mountedOnRealAuth()

      await mounted.invitedTo({ key: 'acme', email: ANN, locale: 'es' })

      expect((await atFloor(mounted, signUpIn('en', 'Ann@Example.test')))?.status).toBe(202)
      expect(await mounted.localeOf(ANN)).toBe('es')
    },
    REAL_SIGN_UPS_MS,
  )

  it('answers a refusal of Better Auth after the lookup no sooner than the floor', async () => {
    const mounted = await mountedOnRealAuth()
    let settled = false
    const pending = mounted
      .route(signUpIn('en', ANN, 'https://elsewhere.test'), FROM)
      .then((answer) => {
        settled = true

        return answer
      })

    await vi.waitFor(() => expect(mounted.clock.pending()).toBe(1))
    await mounted.clock.advance(SIGN_UP_FLOOR_MS - 1)
    expect(settled).toBe(false)
    await mounted.clock.advance(1)
    expect((await pending)?.status).toBe(403)
  })

  it(
    'looks the language up once for a new email and once for a taken one',
    async () => {
      let lookups: ReturnType<typeof counted> | undefined
      const mounted = await mountedOnRealAuth({
        startingLanguage: (real) => {
          lookups = counted(real)

          return lookups.wrap()
        },
      })

      expect((await atFloor(mounted, signUpIn('en')))?.status).toBe(202)
      expect((await atFloor(mounted, signUpIn('en')))?.status).toBe(202)
      expect(lookups?.asked).toEqual([ANN, ANN])
    },
    REAL_SIGN_UPS_MS,
  )

  it(
    "answers a new and a taken email at the floor while the lookup's reads are held past its budget",
    async () => {
      const gates: Array<() => void> = []
      let reached = 0
      const mounted = await mountedOnRealAuth({
        budgetOnGatewayClock: true,
        languageReads: (local) =>
          interceptQueries(local, (text) => {
            if (text !== invitationsToEmailStatement) {
              return undefined
            }

            reached += 1

            return new Promise<void>((release) => {
              gates.push(release)
            })
          }),
      })

      onTestFinished(() => {
        for (const release of gates) {
          release()
        }
      })

      for (const round of [1, 2]) {
        let settled = false
        const pending = mounted.route(signUpIn('en'), FROM).then((answer) => {
          settled = true

          return answer
        })

        await vi.waitFor(() => expect(reached).toBe(round))
        await mounted.clock.advance(STARTING_LANGUAGE_BUDGET_MS)
        // Better Auth took the sign-up once the lookup gave up: only the floor holds it now.
        await vi.waitFor(() => expect(mounted.clock.pending()).toBe(1), ARGON2_WAIT)
        await mounted.clock.advance(SIGN_UP_FLOOR_MS - STARTING_LANGUAGE_BUDGET_MS - 1)
        expect(settled).toBe(false)
        await mounted.clock.advance(1)
        expect((await pending)?.status).toBe(202)
      }

      expect(mounted.failures).toEqual([
        'sign-up:STARTING_LANGUAGE_LATE',
        'sign-up:STARTING_LANGUAGE_LATE',
      ])
    },
    REAL_SIGN_UPS_MS,
  )
})
