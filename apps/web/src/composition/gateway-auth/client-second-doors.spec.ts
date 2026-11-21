import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeFetch, respond, respondText } from '../__fixtures__/gateway-fetch'
import { namesNone } from '../__fixtures__/rejection'

import { gatewayAuth } from './client'

const BASE = 'https://app.example.test/backend'

const credentials = { email: 'ann@example.test', password: 'Pass-word-1' }

const device = { id: 'device-1', label: 'Chrome on Linux' }

const ann = identityIdFactory.create()

/** What an accepted sign-in answers: the raw session token and the account. */
const signedIn = {
  token: 'token-1',
  user: { id: ann, email: credentials.email, name: 'Ann', emailVerified: true },
}

const challenge = 'two_factor=abc.def%2Bghi'

const step = { challenge, email: credentials.email, code: '123456', signOutOldest: false }

const assertion = {
  id: 'credential-1',
  rawId: 'AQID',
  type: 'public-key' as const,
  clientExtensionResults: {},
  response: { authenticatorData: 'BA', clientDataJSON: 'BQ', signature: 'Bg' },
}

const authenticationOptions = { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' }

describe('the password step of an account whose second factor is on', () => {
  it('answers the challenge to carry to the code step, and signs nothing in', async () => {
    const { fetcher } = fakeFetch(respond(200, { secondFactor: { challenge } }))

    expect((await gatewayAuth(BASE, fetcher).signIn(credentials, device))._unsafeUnwrap()).toEqual({
      kind: 'code-required',
      challenge,
    })
  })

  it('answers a signed-in account as a device, as before', async () => {
    const { fetcher } = fakeFetch(respond(200, signedIn))

    expect((await gatewayAuth(BASE, fetcher).signIn(credentials, device))._unsafeUnwrap()).toEqual({
      kind: 'signed-in',
      device: { identity: { id: ann, email: credentials.email }, token: 'token-1' },
    })
  })

  it('answers a sign-in past the limit of devices as an outcome, not a failure', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'device-limit' }))

    expect((await gatewayAuth(BASE, fetcher).signIn(credentials, device))._unsafeUnwrap()).toEqual({
      kind: 'device-limit',
    })
  })

  it('refuses an answer that names no challenge', async () => {
    const { fetcher } = fakeFetch(respond(200, { secondFactor: {} }))

    expect(
      (await gatewayAuth(BASE, fetcher).signIn(credentials, device))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })
})

describe('the code step', () => {
  it('asks the gateway at its own path with the challenge, the email, the code and the device', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect((await gatewayAuth(BASE, fetcher).confirmSignIn(step, device)).isOk()).toBe(true)
    expect(sent).toEqual([
      {
        url: `${BASE}/auth/confirm-sign-in`,
        method: 'POST',
        authorization: null,
        device: 'device-1',
        label: 'Chrome on Linux',
        body: { challenge, email: credentials.email, code: '123456' },
      },
    ])
  })

  it('confirms signing out the device seen least recently only when asked to', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect(
      (
        await gatewayAuth(BASE, fetcher).confirmSignIn({ ...step, signOutOldest: true }, device)
      ).isOk(),
    ).toBe(true)

    expect(sent[0]?.body).toEqual({
      challenge,
      email: credentials.email,
      code: '123456',
      signOutOldest: true,
    })
  })

  it('answers the device the gateway signed in, with the start of an account that has none', async () => {
    const { fetcher } = fakeFetch(
      respond(200, { ...signedIn, start: { name: 'Ann', locale: 'es' } }),
    )

    expect((await gatewayAuth(BASE, fetcher).confirmSignIn(step, device))._unsafeUnwrap()).toEqual({
      kind: 'signed-in',
      device: {
        identity: { id: ann, email: credentials.email },
        token: 'token-1',
        start: { name: 'Ann', locale: 'es' },
      },
    })
  })

  it.each([
    ['a wrong code (400 invalid-code)', 400, { code: 'invalid-code' }, 'data:INVALID_CODE'],
    ['a dead challenge (401 code-expired)', 401, { code: 'code-expired' }, 'data:CODE_EXPIRED'],
    [
      'a banned account (403 account-banned)',
      403,
      { code: 'account-banned' },
      'data:ACCOUNT_BANNED',
    ],
    ['an email to wait for (429 rate-limited)', 429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    ['a malformed step (400 bad-request)', 400, { code: 'bad-request' }, 'data:AUTH_FAILED'],
    ['a gateway failure (500 internal)', 500, { code: 'internal' }, 'data:AUTH_FAILED'],
  ] as const)('keeps the meaning of %s', async (_, status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (
      await gatewayAuth(BASE, fetcher).confirmSignIn(step, device)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, credentials.email, challenge, step.code)
  })

  it('tells a 401 of the password step (wrong credentials) from a 401 of the code step (a dead challenge)', async () => {
    const wrong = () => fakeFetch(respond(401, { code: 'INVALID_EMAIL_OR_PASSWORD' })).fetcher
    const dead = () => fakeFetch(respond(401, { code: 'code-expired' })).fetcher

    expect(
      (await gatewayAuth(BASE, wrong()).signIn(credentials, device))._unsafeUnwrapErr().code,
    ).toBe('data:INVALID_CREDENTIALS')
    expect(
      (await gatewayAuth(BASE, dead()).confirmSignIn(step, device))._unsafeUnwrapErr().code,
    ).toBe('data:CODE_EXPIRED')
    // The code step has no credentials to be wrong: a 401 that names none of its codes is a failure.
    expect(
      (await gatewayAuth(BASE, wrong()).confirmSignIn(step, device))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it.each([
    ['a 409 that names another code', 409, { code: 'account-banned' }],
    ['a 409 that names no code', 409, {}],
    ['a 400 that names the code of a dead challenge', 400, { code: 'code-expired' }],
    ['a 401 that names the code of a wrong code', 401, { code: 'invalid-code' }],
    ['a 403 Better Auth refused for the origin', 403, { code: 'INVALID_ORIGIN' }],
    ['a 401 that names the ban', 401, { code: 'account-banned' }],
    ['a 429 that names no code', 429, {}],
    ['a 429 that names another code', 429, { code: 'invalid-code' }],
  ] as const)('fails as an attempt that did not go through on %s', async (_, status, body) => {
    const { fetcher } = fakeFetch(respond(status, body))

    expect(
      (await gatewayAuth(BASE, fetcher).confirmSignIn(step, device))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('answers the limit of devices as an outcome', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'device-limit' }))

    expect((await gatewayAuth(BASE, fetcher).confirmSignIn(step, device))._unsafeUnwrap()).toEqual({
      kind: 'device-limit',
    })
  })

  it('reads an answer that is no signed-in account as a failure, quoting none of it', async () => {
    const { fetcher } = fakeFetch(respond(200, { token: 'token-9', user: 'ann' }))
    const failed = (await gatewayAuth(BASE, fetcher).confirmSignIn(step, device))._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    namesNone(failed, 'token-9')
  })

  it('answers an unreachable gateway as data:OFFLINE naming nothing it sent', async () => {
    const auth = gatewayAuth(BASE, () =>
      Promise.reject(new Error(`down ${step.code} ${challenge}`)),
    )
    const offline = (await auth.confirmSignIn(step, device))._unsafeUnwrapErr()

    expect(offline.code).toBe('data:OFFLINE')
    namesNone(offline, step.code, challenge, credentials.email)
  })
})

describe('the options of a passkey sign-in', () => {
  it('asks a guest path with the device and no token, and answers the options with their challenge', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { options: authenticationOptions, challenge }))

    expect((await gatewayAuth(BASE, fetcher).passkeyOptions(device))._unsafeUnwrap()).toEqual({
      options: authenticationOptions,
      challenge,
    })
    expect(sent).toEqual([
      {
        url: `${BASE}/auth/passkey-options`,
        method: 'POST',
        authorization: null,
        device: 'device-1',
        label: 'Chrome on Linux',
        body: undefined,
      },
    ])
  })

  it.each([
    ['no options', { challenge }],
    ['options without a challenge', { options: {}, challenge }],
    ['no challenge', { options: authenticationOptions }],
  ])('refuses an answer with %s', async (_, body) => {
    const { fetcher } = fakeFetch(respond(200, body))

    expect((await gatewayAuth(BASE, fetcher).passkeyOptions(device))._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
  })

  it('fails as data:AUTH_FAILED naming the status when the gateway refuses', async () => {
    const { fetcher } = fakeFetch(respond(500, { code: 'internal' }))
    const failed = (await gatewayAuth(BASE, fetcher).passkeyOptions(device))._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(failed.message).toContain('500')
  })
})

describe('the passkey sign-in', () => {
  const asked = { response: assertion, challenge }

  it('sends the assertion with its challenge and the device, and answers the device the gateway signed in', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect(
      (await gatewayAuth(BASE, fetcher).signInWithPasskey(asked, device))._unsafeUnwrap(),
    ).toEqual({
      kind: 'signed-in',
      device: { identity: { id: ann, email: credentials.email }, token: 'token-1' },
    })
    expect(sent).toEqual([
      {
        url: `${BASE}/auth/sign-in/passkey`,
        method: 'POST',
        authorization: null,
        device: 'device-1',
        label: 'Chrome on Linux',
        body: { response: assertion, challenge },
      },
    ])
  })

  it('names the account whose limit of devices the person confirmed only when it is given', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect(
      (
        await gatewayAuth(BASE, fetcher).signInWithPasskey(
          { ...asked, signOutOldestFor: ann },
          device,
        )
      ).isOk(),
    ).toBe(true)

    expect(sent[0]?.body).toEqual({ response: assertion, challenge, signOutOldestFor: ann })
  })

  it('answers the limit of devices with the account it asked about', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'device-limit', consentFor: ann }))

    expect(
      (await gatewayAuth(BASE, fetcher).signInWithPasskey(asked, device))._unsafeUnwrap(),
    ).toEqual({ kind: 'device-limit', consentFor: ann })
  })

  it.each([
    [
      'a passkey no account holds (401 passkey-unknown)',
      401,
      { code: 'passkey-unknown' },
      'data:PASSKEY_UNKNOWN',
    ],
    [
      'a banned account (403 account-banned)',
      403,
      { code: 'account-banned' },
      'data:ACCOUNT_BANNED',
    ],
    ['an assertion that failed (400 failed)', 400, { code: 'failed' }, 'data:AUTH_FAILED'],
    ['a malformed request (400 bad-request)', 400, { code: 'bad-request' }, 'data:AUTH_FAILED'],
    ['a gateway failure (500 internal)', 500, { code: 'internal' }, 'data:AUTH_FAILED'],
  ] as const)('keeps the meaning of %s', async (_, status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (
      await gatewayAuth(BASE, fetcher).signInWithPasskey(asked, device)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, challenge, assertion.rawId)
  })

  it.each([
    ['a 409 that names no account', 409, { code: 'device-limit' }],
    ['a 409 that names another code', 409, { code: 'account-banned', consentFor: ann }],
    ['a 409 that names no code', 409, { consentFor: ann }],
    ['a 409 whose account is no identity', 409, { code: 'device-limit', consentFor: 'abc' }],
    ['a 401 that names the code of a dead challenge', 401, { code: 'code-expired' }],
    ['a 401 that names no code', 401, {}],
    ['a 400 that names the code of a wrong code', 400, { code: 'invalid-code' }],
    ['a 403 Better Auth refused for the origin', 403, { code: 'INVALID_ORIGIN' }],
    ['a 403 that names no code', 403, {}],
    ['a 429, which this door never answers', 429, { code: 'rate-limited' }],
  ] as const)('fails as an attempt that did not go through on %s', async (_, status, body) => {
    const { fetcher } = fakeFetch(respond(status, body))

    expect(
      (await gatewayAuth(BASE, fetcher).signInWithPasskey(asked, device))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('reads a body that is no JSON as the failure of its status', async () => {
    const { fetcher } = fakeFetch(respondText(401, '<html>unauthorized</html>'))

    expect(
      (await gatewayAuth(BASE, fetcher).signInWithPasskey(asked, device))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('answers an unreachable gateway as data:OFFLINE naming nothing it sent', async () => {
    const auth = gatewayAuth(BASE, () => Promise.reject(new Error(`down ${challenge}`)))
    const offline = (await auth.signInWithPasskey(asked, device))._unsafeUnwrapErr()

    expect(offline.code).toBe('data:OFFLINE')
    namesNone(offline, challenge, assertion.rawId)
  })
})
