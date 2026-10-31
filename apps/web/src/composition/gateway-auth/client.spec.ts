import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond, respondText } from '../__fixtures__/gateway-fetch'

import { type Fetcher, type GatewayAuth, gatewayAuth } from './client'

const BASE = 'https://app.example.test/backend'

const credentials = { email: 'ann@example.test', password: 'pass-word-1' }

const signUpInput = { ...credentials, name: 'Ann' }

const device = { id: 'device-1', label: 'Chrome on Linux' }

const ann = identityIdFactory.create()

/** The account as the gateway answers a sign-up or sign-in with it. */
const user = {
  id: ann,
  email: credentials.email,
  name: 'Ann',
  emailVerified: false,
  image: null,
  createdAt: '2026-10-31T08:00:00.000Z',
  updatedAt: '2026-10-31T08:00:00.000Z',
}

/** A sign-in's answer: the raw session token and the account. */
const signedIn = { redirect: false, token: 'token-1', user }

/** An answer with a JSON body and the signed token in `set-auth-token`, as the gateway sends it. */
const withSignedHeader = (body: unknown) => () =>
  Promise.resolve(
    Response.json(body, { status: 200, headers: { 'set-auth-token': 'token-1.signature' } }),
  )

const signUp = (auth: GatewayAuth) => auth.signUp(signUpInput, device)
const signIn = (auth: GatewayAuth) => auth.signIn(credentials, device)

/** The token a verification link carries, and the session token its first exchange gives. */
const LINK_TOKEN = 'link-token-1'
const SESSION_TOKEN = 'session-token-1'

/** The first verification's answer: the raw session token and the account as it signed up. */
const verified = {
  token: SESSION_TOKEN,
  user: { id: ann, email: credentials.email, name: 'Ann', locale: 'es' },
}

const verify = (auth: GatewayAuth, token = LINK_TOKEN) => auth.verifyEmail(token, device)

/** An answer without a body that accepts the request (202). */
const accepted = () => () => Promise.resolve(new Response(null, { status: 202 }))

/** `fetcher`, also recording the content type each request names. */
function typed(fetcher: Fetcher) {
  const types: Array<string | null> = []
  const recording: Fetcher = (url, init) => {
    types.push(new Headers(init.headers).get('Content-Type'))

    return fetcher(url, init)
  }

  return { fetcher: recording, types }
}

/** Whether `error` says nothing of `secrets`, in its message or anywhere else it carries. */
function namesNone(error: DataError, ...secrets: string[]): void {
  for (const secret of secrets) {
    expect(error.message).not.toContain(secret)
    expect(JSON.stringify(error)).not.toContain(secret)
  }
}

describe('gatewayAuth', () => {
  it('signs up naming the device, and answers with the identity and its session token only', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { token: 'token-1', user }))

    expect((await signUp(gatewayAuth(BASE, fetcher)))._unsafeUnwrap()).toEqual({
      identity: { id: ann, email: credentials.email },
      token: 'token-1',
    })
    // Nothing else is asked: the session reads the memberships itself, with the token it keeps.
    expect(sent).toEqual([
      {
        url: `${BASE}/auth/sign-up/email`,
        method: 'POST',
        authorization: null,
        device: 'device-1',
        label: 'Chrome on Linux',
        body: signUpInput,
      },
    ])
  })

  it('signs in at its own path with the email and the password only, naming the device', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect((await signIn(gatewayAuth(BASE, fetcher)))._unsafeUnwrap()).toEqual({
      identity: { id: ann, email: credentials.email },
      token: 'token-1',
    })
    expect(sent.map(({ url, label, body }) => ({ url, label, body }))).toEqual([
      { url: `${BASE}/auth/sign-in/email`, label: 'Chrome on Linux', body: credentials },
    ])
  })

  it('keeps the raw token of the body, never the signed one of the set-auth-token header', async () => {
    const { fetcher } = fakeFetch(withSignedHeader(signedIn))

    expect((await signIn(gatewayAuth(BASE, fetcher)))._unsafeUnwrap().token).toBe('token-1')

    // An answer whose body carries no token signs nobody in, whatever its header says.
    const tokenless = fakeFetch(withSignedHeader({ ...signedIn, token: null }))
    const refused = (await signIn(gatewayAuth(BASE, tokenless.fetcher)))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).not.toContain('token-1')
  })

  it('reads 401 as wrong credentials, asking nothing more', async () => {
    const { fetcher, sent } = fakeFetch(
      respond(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }),
    )

    expect((await signIn(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CREDENTIALS',
    )
    expect(sent).toHaveLength(1)
  })

  it('reads 403 to a sign-in as an email not verified yet', async () => {
    const { fetcher } = fakeFetch(
      respond(403, { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' }),
    )

    expect((await signIn(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe(
      'data:EMAIL_NOT_VERIFIED',
    )
  })

  it('reads 422 as a refused sign-up', async () => {
    const { fetcher } = fakeFetch(
      respond(422, {
        code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
        message: 'User already exists',
      }),
    )

    expect((await signUp(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe(
      'data:SIGN_UP_REJECTED',
    )
  })

  it('reads 429 to a sign-up or a sign-in as a request to wait', async () => {
    for (const run of [signUp, signIn]) {
      const { fetcher } = fakeFetch(respond(429, { code: 'rate-limited' }))

      expect((await run(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe(
        'data:RATE_LIMITED',
      )
    }
  })

  it('reads any other refusal as a failed attempt naming its status', async () => {
    const { fetcher } = fakeFetch(respond(400, { code: 'PASSWORD_TOO_SHORT' }))
    const refused = (await signUp(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).toBe('the gateway refused the request with 400')
  })

  it('is offline when the gateway cannot be reached', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect((await signIn(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('fails when the answer is not what the gateway promises', async () => {
    for (const answer of [
      respond(200, { token: 'token-1', user: { ...user, id: 'usr_x' } }),
      respond(200, { token: '', user }),
      respondText(200, '<html>'),
    ]) {
      const { fetcher } = fakeFetch(answer)

      expect((await signIn(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe(
        'data:AUTH_FAILED',
      )
    }
  })

  it('signs a token out with a POST carrying it as the bearer token and naming the device', async () => {
    const { fetcher, sent } = fakeFetch(noContent())

    expect((await gatewayAuth(BASE, fetcher).signOut('token-1', 'device-1')).isOk()).toBe(true)
    expect(sent).toEqual([
      {
        url: `${BASE}/auth/sign-out`,
        method: 'POST',
        authorization: 'Bearer token-1',
        device: 'device-1',
        body: undefined,
      },
    ])
  })

  it('reads 401 to a sign-out as a token that signs nobody in any more', async () => {
    const { fetcher } = fakeFetch(respond(401, { code: 'unauthorized' }))

    expect(
      (await gatewayAuth(BASE, fetcher).signOut('token-1', 'device-1'))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('reads another 4xx to a sign-out as a refusal the gateway will never take back', async () => {
    for (const status of [400, 404]) {
      const { fetcher } = fakeFetch(respond(status, { code: 'bad-request' }))
      const refused = (
        await gatewayAuth(BASE, fetcher).signOut('token-1', 'device-1')
      )._unsafeUnwrapErr()

      expect(refused.code).toBe('data:WRITE_REJECTED')
      expect(refused.message).toMatch(new RegExp(String(status)))
      expect(refused.message).not.toContain('token-1')
    }
  })

  it('reads 429 to a sign-out as a request to wait, not as a refusal for good', async () => {
    const { fetcher } = fakeFetch(respond(429, { code: 'rate-limited' }))
    const refused = (
      await gatewayAuth(BASE, fetcher).signOut('token-1', 'device-1')
    )._unsafeUnwrapErr()

    expect(refused.code).toBe('data:RATE_LIMITED')
    expect(refused.message).not.toContain('token-1')
  })

  it('fails a sign-out the gateway could not complete with its status, never the token', async () => {
    const { fetcher } = fakeFetch(respond(500, { code: 'internal' }))
    const failed = (
      await gatewayAuth(BASE, fetcher).signOut('token-1', 'device-1')
    )._unsafeUnwrapErr()

    expect(failed.code).toBe('data:WRITE_FAILED')
    expect(failed.message).toMatch(/500/)
    expect(failed.message).not.toContain('token-1')
  })

  it('is offline when a sign-out cannot reach the gateway', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(
      (await gatewayAuth(BASE, fetcher).signOut('token-1', 'device-1'))._unsafeUnwrapErr().code,
    ).toBe('data:OFFLINE')
  })
})

describe('gatewayAuth.verifyEmail', () => {
  it("posts the link's token in the body, naming the device, never in the address", async () => {
    const recorded = fakeFetch(respond(200, verified))
    const { fetcher, types } = typed(recorded.fetcher)

    expect((await verify(gatewayAuth(BASE, fetcher))).isOk()).toBe(true)
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/verify-email`,
        method: 'POST',
        authorization: null,
        device: 'device-1',
        label: 'Chrome on Linux',
        body: { token: LINK_TOKEN },
      },
    ])
    expect(types).toEqual(['application/json'])
  })

  it('answers the first verification with the device signed in and the account as it signed up', async () => {
    const { fetcher } = fakeFetch(respond(200, verified))

    expect((await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrap()).toEqual({
      kind: 'signed-in',
      device: { identity: { id: ann, email: credentials.email }, token: SESSION_TOKEN },
      account: { name: 'Ann', locale: 'es' },
    })
  })

  it('answers a link verified before as such, signing nothing in', async () => {
    const { fetcher } = fakeFetch(respond(200, { token: null }))

    expect((await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrap()).toEqual({
      kind: 'verified-before',
    })
  })

  it('reads 401 link-expired as an expired link, and any other 401 or a 400 as an invalid one', async () => {
    for (const [answer, code] of [
      [respond(401, { code: 'link-expired' }), 'data:LINK_EXPIRED'],
      [respond(401, { code: 'link-invalid' }), 'data:LINK_INVALID'],
      [respond(401, { code: 'unauthorized' }), 'data:LINK_INVALID'],
      [respondText(401, '<html>'), 'data:LINK_INVALID'],
      [respond(400, { code: 'bad-request' }), 'data:LINK_INVALID'],
    ] as const) {
      const { fetcher } = fakeFetch(answer)
      const refused = (await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr()

      expect(refused.code).toBe(code)
      namesNone(refused, LINK_TOKEN)
    }
  })

  it('reads 429 to a verification as a request to wait', async () => {
    const { fetcher } = fakeFetch(respond(429, { code: 'rate-limited' }))

    expect((await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe(
      'data:RATE_LIMITED',
    )
  })

  it('fails a verification the gateway could not complete with its status, never a token', async () => {
    const { fetcher } = fakeFetch(respond(500, { code: 'internal' }))
    const failed = (await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(failed.message).toMatch(/500/)
    namesNone(failed, LINK_TOKEN)
  })

  it('is offline when a verification cannot reach the gateway', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect((await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('refuses a link without a token as invalid, asking the gateway nothing', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, verified))

    expect((await verify(gatewayAuth(BASE, fetcher), ''))._unsafeUnwrapErr().code).toBe(
      'data:LINK_INVALID',
    )
    expect(sent).toEqual([])
  })

  it('fails when the answer is not what the gateway promises, naming no token', async () => {
    for (const answer of [
      respond(200, { ...verified, user: { ...verified.user, locale: 'fr' } }),
      respond(200, { ...verified, user: { ...verified.user, id: 'usr_x' } }),
      respond(200, { token: SESSION_TOKEN }),
      respond(200, { ...verified, token: '' }),
      respond(200, {}),
      respondText(200, '<html>'),
    ]) {
      const { fetcher } = fakeFetch(answer)
      const failed = (await verify(gatewayAuth(BASE, fetcher)))._unsafeUnwrapErr()

      expect(failed.code).toBe('data:AUTH_FAILED')
      namesNone(failed, LINK_TOKEN, SESSION_TOKEN)
    }
  })
})

describe('gatewayAuth.resendVerification', () => {
  const email = 'Ann@example.test'

  it('asks for the mail again with the email alone, no credentials and no device', async () => {
    const recorded = fakeFetch(accepted())
    const { fetcher, types } = typed(recorded.fetcher)

    expect((await gatewayAuth(BASE, fetcher).resendVerification(email)).isOk()).toBe(true)
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/send-verification-email`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { email },
      },
    ])
    expect(types).toEqual(['application/json'])
  })

  it('reads 429 to a resend as a request to wait', async () => {
    const { fetcher } = fakeFetch(respond(429, { code: 'rate-limited' }))

    expect(
      (await gatewayAuth(BASE, fetcher).resendVerification(email))._unsafeUnwrapErr().code,
    ).toBe('data:RATE_LIMITED')
  })

  it('reads another 4xx to a resend as a refusal, and a failure as a resend that may be asked again', async () => {
    for (const [status, code] of [
      [400, 'data:WRITE_REJECTED'],
      [404, 'data:WRITE_REJECTED'],
      [500, 'data:WRITE_FAILED'],
    ] as const) {
      const { fetcher } = fakeFetch(respond(status, { code: 'bad-request' }))
      const refused = (
        await gatewayAuth(BASE, fetcher).resendVerification(email)
      )._unsafeUnwrapErr()

      expect(refused.code).toBe(code)
      expect(refused.message).toMatch(new RegExp(String(status)))
      namesNone(refused, email, email.toLowerCase())
    }
  })

  it('is offline when a resend cannot reach the gateway', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(
      (await gatewayAuth(BASE, fetcher).resendVerification(email))._unsafeUnwrapErr().code,
    ).toBe('data:OFFLINE')
  })
})
