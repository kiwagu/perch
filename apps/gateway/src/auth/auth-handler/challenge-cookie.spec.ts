import { afterEach, describe, expect, it } from 'vitest'

import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from '../__fixtures__/auth-instance'
import { codeOf, passwordStepRequest, secondFactorOn } from '../__fixtures__/second-factor'
import { ADMISSION_HEADER, DEVICE_HEADER, DEVICE_LABEL_HEADER } from '../session-hooks'

import {
  challengeOwner,
  internalRequest,
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
