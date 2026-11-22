import { afterEach, describe, expect, it } from 'vitest'

import { openTestDb } from '@workspace/data/testing'
import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { DIRECTORY, NAMESPACE } from '../../config'
import { linkToken } from '../../mail/__fixtures__/outbox'
import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from '../__fixtures__/auth-instance'
import { selectionReads } from '../__fixtures__/query-plan'
import { codeOf, passwordStepRequest, secondFactorOn } from '../__fixtures__/second-factor'
import twoFactorAttemptsSetStatement from '../__fixtures__/two-factor-attempts-set.surql'
import {
  identifiersIn,
  identifiersOf,
  keptRows,
  passkeyCeremony,
  twoFactorChallenge,
  written,
} from '../__fixtures__/verification'
import { ADMISSION_HEADER, DEVICE_HEADER, DEVICE_LABEL_HEADER } from '../session-hooks'
import twoFactorChallengesReclaimStatement from '../surql/two-factor-challenges-reclaim.surql'

import {
  challengeOwner,
  challengeTakesCode,
  challengeValue,
  internalRequest,
  RECLAIMED_PER_CHALLENGE,
  reclaimChallenges,
  setCookieValue,
  twoFactorChallenges,
} from './challenge-cookie'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'

/** The front's origin the fixture's instance trusts and serves its routes behind. */
const ORIGIN = 'http://localhost'

/** The device a sign-in's second step comes from. */
const PHONE = { id: 'phone', label: 'Firefox on Android' }

/**
 * Ann signed up and verified on her laptop with her second factor on, and the challenge a
 * password step from her phone answered, as Better Auth set its cookie.
 */
async function challenged() {
  const opened = await openAuth()

  closers.push(opened.close)

  const { token, user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
  const factor = await secondFactorOn(opened.auth, 'laptop', token)
  const challenges = twoFactorChallenges(opened.auth, opened.local)
  const name = await challenges.cookieName()
  const answer = await opened.auth.handler(passwordStepRequest(ANN, 'Pass-word-1', 'phone'))
  const challenge = setCookieValue(answer, name) ?? expect.unreachable('a challenge cookie')

  return {
    ...opened,
    identity: idSchemas.identity.schema.parse(user.id),
    factor,
    challenges,
    name,
    answer,
    challenge,
  }
}

describe('setCookieValue', () => {
  it("reads a cookie's value as the set-cookie answer carries it, never decoded, and none for one emptied or not set", () => {
    const headers = new Headers()

    headers.append('set-cookie', 'better-auth.session_token=; Max-Age=0; Path=/; HttpOnly')
    headers.append(
      'set-cookie',
      'better-auth.two_factor=2fa-abc.c2ln%2Bb%2Fg%3D; Max-Age=600; Path=/; HttpOnly; SameSite=Lax',
    )

    const answer = new Response(null, { headers })

    expect(setCookieValue(answer, 'better-auth.two_factor')).toBe('2fa-abc.c2ln%2Bb%2Fg%3D')
    expect(setCookieValue(answer, 'better-auth.session_token')).toBeUndefined()
    // A name is matched whole.
    expect(setCookieValue(answer, 'two_factor')).toBeUndefined()
    expect(setCookieValue(new Response(null), 'better-auth.two_factor')).toBeUndefined()
  })

  it.each([
    ['a space before it', 'better-auth.two_factor= 2fa-abc.c2ln%3D; Path=/'],
    ['a space after it', 'better-auth.two_factor=2fa-abc.c2ln%3D ; Path=/'],
    ['a tab before it', 'better-auth.two_factor=\t2fa-abc.c2ln%3D; Path=/'],
  ])(
    'reads no value padded with %s: the value is taken as it stands, never trimmed into one',
    (_, cookie) => {
      const headers = new Headers()

      headers.append('set-cookie', cookie)

      expect(setCookieValue(new Response(null, { headers }), 'better-auth.two_factor')).toBe(
        undefined,
      )
    },
  )
})

describe('twoFactorChallenges', () => {
  it("names Better Auth's two-factor cookie as Better Auth names it: its namespace, no secure prefix on an http base URL", async () => {
    const { name, answer } = await challenged()

    expect(name).toBe('better-auth.two_factor')
    expect(answer.headers.getSetCookie().some((cookie) => cookie.startsWith(`${name}=`))).toBe(true)
  }, 30_000)
})

describe('challengeOwner', () => {
  it("finds the account a password step's challenge belongs to by the challenge's own row, and none for any other value", async () => {
    const { local, identity, challenge } = await challenged()
    const ownerOf = async (value: string) => (await challengeOwner(local, value))._unsafeUnwrap()
    const decoded = decodeURIComponent(challenge)
    const [identifier = '', signature = ''] = decoded.split('.')

    expect(await ownerOf(challenge)).toBe(identity)
    expect(await ownerOf('2fa-nobody-has-this.c2lnbmF0dXJl')).toBeUndefined()
    // The row counting the challenge's codes holds a count, not an account.
    expect(await ownerOf(`2fa-attempts-${identifier}.${signature}`)).toBeUndefined()
    expect(await ownerOf('not-a-challenge')).toBeUndefined()
  }, 30_000)

  it("finds no account for a value naming another kind of row, a reset link's", async () => {
    const opened = await openAuth()

    closers.push(opened.close)

    await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))

    const seen = opened.outbox.to(ANN).length

    expect((await accountServicesOf(opened).passwords.requestReset(ANN))._unsafeUnwrap()).toBe(
      'asked',
    )

    const token = linkToken(await opened.outbox.next(ANN, seen))

    expect(
      (await challengeOwner(opened.local, `reset-password:${token}.c2lnbmF0dXJl`))._unsafeUnwrap(),
    ).toBeUndefined()
  }, 30_000)
})

describe('challengeTakesCode', () => {
  it('takes a code for a challenge a password step just answered, and none past its ten minutes, after five codes counted, with a count that is no whole number, or for a value naming no challenge', async () => {
    const { local, challenge } = await challenged()
    const [identifier = ''] = decodeURIComponent(challenge).split('.')
    const takes = async (value: string, now = new Date()) =>
      (await challengeTakesCode(local, value, now))._unsafeUnwrap()

    expect(await takes(challenge)).toBe(true)
    expect(await takes(challenge, new Date(Date.now() + 11 * 60_000))).toBe(false)
    expect(await takes('2fa-nobody-has-this.c2lnbmF0dXJl')).toBe(false)
    expect(await takes('not-a-challenge')).toBe(false)

    for (const [count, taken] of [
      ['4', true],
      ['5', false],
      ['1.5', false],
      ['-1', false],
      ['many', false],
    ] as const) {
      await local.db.query(twoFactorAttemptsSetStatement, { identifier, value: count })

      expect(await takes(challenge)).toBe(taken)
    }
  }, 30_000)
})

describe('reclaimChallenges', () => {
  /** A directory of its own, closed when the test ends. */
  async function directory() {
    const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()

    closers.push(() => local.close())

    return local
  }

  it('ends the challenges that expired over a minute ago with the rows counting their codes, a count left alone included, and no other row', async () => {
    const local = await directory()
    const [, orphanCount] = twoFactorChallenge('spent', -3)
    const expired = [
      ...twoFactorChallenge('old', -10),
      ...twoFactorChallenge('older', -60),
      // The row counting the codes of a challenge already gone.
      orphanCount,
    ]
    const kept = [
      ...keptRows('a'),
      ...twoFactorChallenge('live', 9),
      ...twoFactorChallenge('recent', -0.5),
      passkeyCeremony('authentication-old', 'authentication', -10),
    ]

    await written(local, [...expired, ...kept])
    ;(await reclaimChallenges(local))._unsafeUnwrap()

    expect(await identifiersIn(local)).toEqual(identifiersOf(kept))
  })

  it('reads at most its bound of rows each time, so a backlog of challenges drains over several', async () => {
    const local = await directory()

    // Twelve challenges left unanswered, each expired a minute apart, the earliest first.
    await written(
      local,
      Array.from({ length: 12 }, (_, at) => twoFactorChallenge(`left-${at}`, -2 - at)).flat(),
    )
    ;(await reclaimChallenges(local))._unsafeUnwrap()

    // The ten rows of the five earliest expired went, each challenge with its count.
    expect(await identifiersIn(local)).toHaveLength(24 - RECLAIMED_PER_CHALLENGE)

    ;(await reclaimChallenges(local))._unsafeUnwrap()
    ;(await reclaimChallenges(local))._unsafeUnwrap()

    expect(await identifiersIn(local)).toEqual([])
  })

  it('reads the expired challenges through the index of their expiry, never the whole table: as many rows as it ends', async () => {
    const local = await directory()
    const expired = [...twoFactorChallenge('old', -10), ...twoFactorChallenge('older', -20)]

    // Many rows the read must not walk: expired rows of other kinds and live challenges.
    await written(local, [
      ...expired,
      ...Array.from({ length: 8 }, (_, at) => keptRows(`${at}`)).flat(),
      ...Array.from({ length: 8 }, (_, at) =>
        passkeyCeremony(`authentication-${at}`, 'authentication', -30),
      ),
      ...Array.from({ length: 8 }, (_, at) => twoFactorChallenge(`live-${at}`, 9)).flat(),
    ])

    const reads = await selectionReads(local, twoFactorChallengesReclaimStatement, {
      limit: RECLAIMED_PER_CHALLENGE,
    })

    expect(reads.map(({ operator, index, rows }) => ({ operator, index, rows }))).toEqual([
      { operator: 'IndexScan', index: 'verification_ceremony_expiry', rows: expired.length },
    ])
    // Only the two-factor challenges that expired: the range of the index starts at their kind.
    expect(reads[0]?.access).toMatch(/^\['two-factor'\] LessThan d'/)
  })
})

describe('internalRequest', () => {
  it("builds a verifier's call: a JSON POST to the auth routes behind the front, from the front's origin, the device's headers, the challenge its only cookie, its session asked to wait", async () => {
    const request = internalRequest({
      publicUrl: ORIGIN,
      path: '/two-factor/verify-totp',
      device: PHONE,
      challenge: { name: 'better-auth.two_factor', value: '2fa-abc.c2ln%2Bb%2Fg%3D' },
      pending: true,
      body: { code: '123456' },
    })

    expect([request.method, request.url]).toEqual([
      'POST',
      `${ORIGIN}/backend/auth/two-factor/verify-totp`,
    ])
    expect(Object.fromEntries(request.headers)).toEqual({
      'content-type': 'application/json',
      cookie: 'better-auth.two_factor=2fa-abc.c2ln%2Bb%2Fg%3D',
      origin: ORIGIN,
      [DEVICE_HEADER.toLowerCase()]: 'phone',
      [DEVICE_LABEL_HEADER.toLowerCase()]: 'Firefox on Android',
      [ADMISSION_HEADER.toLowerCase()]: 'pending',
    })
    expect(await request.json()).toEqual({ code: '123456' })
  })

  it("builds an options call: a bodyless GET carrying the caller's bearer, and no cookie at all", () => {
    const request = internalRequest({
      publicUrl: ORIGIN,
      path: '/passkey/generate-register-options',
      device: PHONE,
      bearer: 'raw-token',
    })

    expect([request.method, request.url, request.body]).toEqual([
      'GET',
      `${ORIGIN}/backend/auth/passkey/generate-register-options`,
      null,
    ])
    expect(Object.fromEntries(request.headers)).toEqual({
      authorization: 'Bearer raw-token',
      origin: ORIGIN,
      [DEVICE_HEADER.toLowerCase()]: 'phone',
      [DEVICE_LABEL_HEADER.toLowerCase()]: 'Firefox on Android',
    })
  })
})

/**
 * Values a device may send as its challenge that are not one cookie value on the wire: each would
 * add a cookie, split one, or carry what a cookie value cannot.
 */
const NOT_ONE_COOKIE_VALUE = [
  ['a second cookie after a semicolon', '2fa-abc.c2ln%3D; better-auth.session_token=forged'],
  ['a second cookie after a comma', '2fa-abc.c2ln%3D,better-auth.session_token=forged'],
  ['a space', '2fa-abc. c2ln%3D'],
  ['a quote', '"2fa-abc.c2ln%3D"'],
  ['a backslash', '2fa-abc.c2ln\\%3D'],
  ['a line break', '2fa-abc.c2ln%3D\r\nx-perch-admission: none'],
  ['nothing', ''],
] as const

describe('the boundary of one cookie', () => {
  it.each(NOT_ONE_COOKIE_VALUE)(
    'refuses to build a call whose challenge holds %s, so no value adds a cookie',
    (_, value) => {
      expect(challengeValue.safeParse(value).success).toBe(false)
      expect(() =>
        internalRequest({
          publicUrl: ORIGIN,
          path: '/two-factor/verify-totp',
          device: PHONE,
          challenge: { name: 'better-auth.two_factor', value },
          pending: true,
          body: { code: '123456' },
        }),
      ).toThrow(/one cookie value/)
    },
  )

  it("takes Better Auth's own challenge as it set it, byte for byte, and builds a call with that one cookie", async () => {
    const { name, challenge } = await challenged()
    const request = internalRequest({
      publicUrl: ORIGIN,
      path: '/two-factor/verify-totp',
      device: PHONE,
      challenge: { name, value: challenge },
      body: { code: '123456' },
    })

    expect(challengeValue.parse(challenge)).toBe(challenge)
    expect(request.headers.get('cookie')).toBe(`${name}=${challenge}`)
  }, 30_000)
})

describe('a challenge carried by the device', () => {
  it('signs the device in with a code of the key once the challenge is replayed as Better Auth set it, its signature encoded', async () => {
    const { auth, identity, factor, name, challenge } = await challenged()

    // The signature is base64, so its value on the wire is percent-encoded.
    expect(challenge).toMatch(/%3D$/)

    const answer = await auth.handler(
      internalRequest({
        publicUrl: ORIGIN,
        path: '/two-factor/verify-totp',
        device: PHONE,
        challenge: { name, value: challenge },
        pending: true,
        body: { code: await codeOf(factor.secret) },
      }),
    )
    const body = z
      .object({ token: z.string().min(1), user: z.object({ id: z.string() }) })
      .parse(await answer.json())

    expect(answer.status).toBe(200)
    expect(body.user.id).toBe(identity)
  }, 30_000)
})
