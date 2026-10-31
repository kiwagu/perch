import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond, respondText } from './__fixtures__/gateway-fetch'
import { type GatewayAuth, gatewayAuth } from './gateway-auth'

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
