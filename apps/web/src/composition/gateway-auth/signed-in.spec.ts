import { describe, expect, it } from 'vitest'

import { fakeFetch, respond, respondText } from '../__fixtures__/gateway-fetch'
import { namesNone } from '../__fixtures__/rejection'

import { gatewayAuth } from './client'
import { type ClientAnswer, signedIn } from './signed-in'

const BASE = 'https://app.example.test/backend'

const credentials = { email: 'ann@example.test', password: 'Pass-word-1' }

const device = { id: 'device-1', label: 'Chrome on Linux' }

/** A sign-in the gateway refused with `status` and `body`, through Better Auth's client. */
const refusedWith = (status: number, body: unknown) =>
  gatewayAuth(BASE, fakeFetch(respond(status, body)).fetcher).signIn(credentials, device)

/** The answer Better Auth's client hands a refused sign-in: its status and the body's fields. */
const refusal = (status: number, code?: unknown): ClientAnswer => ({
  data: null,
  error: code === undefined ? { status } : { status, code },
})

describe('what a refused sign-in means', () => {
  it('reads a 403 that names account-banned as a banned account, not an email to verify', async () => {
    const refused = (await signedIn(refusal(403, 'account-banned')))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:ACCOUNT_BANNED')
    namesNone(refused, credentials.email, credentials.password)
  })

  it('reads a 403 that names EMAIL_NOT_VERIFIED, the code the gateway sends, as an email not verified yet', async () => {
    expect((await signedIn(refusal(403, 'EMAIL_NOT_VERIFIED')))._unsafeUnwrapErr().code).toBe(
      'data:EMAIL_NOT_VERIFIED',
    )
  })

  it.each([
    ['an origin Better Auth does not trust', 'INVALID_ORIGIN'],
    ['a cross-site navigation', 'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED'],
    ['a callback URL it does not trust', 'INVALID_CALLBACK_URL'],
    ['a code the gateway never sends for it', 'email-not-verified'],
    ['a code that is no string', 42],
    ['no code', undefined],
  ] as const)(
    'reads a 403 refused for %s as a failed attempt, never as an email to verify: the password was not checked',
    async (_, code) => {
      expect((await signedIn(refusal(403, code)))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    },
  )

  it.each([
    [401, 'INVALID_EMAIL_OR_PASSWORD', 'data:INVALID_CREDENTIALS'],
    [429, 'rate-limited', 'data:RATE_LIMITED'],
  ] as const)('reads %i with the code %s as its own outcome', async (status, code, expected) => {
    expect((await signedIn(refusal(status, code)))._unsafeUnwrapErr().code).toBe(expected)
  })

  it.each([
    [401, undefined],
    [401, 'account-banned'],
    [401, 'code-expired'],
    [429, undefined],
    [429, 'account-banned'],
    [500, 'account-banned'],
  ] as const)('reads %i with the code %s as a failed attempt', async (status, code) => {
    expect((await signedIn(refusal(status, code)))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('reads the limit of devices only from a 409 that names device-limit', async () => {
    expect((await signedIn(refusal(409, 'device-limit')))._unsafeUnwrap()).toEqual({
      kind: 'device-limit',
    })

    for (const code of ['account-banned', 'INVALID_ORIGIN', undefined]) {
      expect((await signedIn(refusal(409, code)))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    }
  })

  it("carries the body's code through Better Auth's client: 403 account-banned is a banned account", async () => {
    const refused = (await refusedWith(403, { code: 'account-banned' }))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:ACCOUNT_BANNED')
    namesNone(refused, credentials.email, credentials.password)
  })

  it("reads a 403 whose body is no JSON, or that Better Auth refused before it checked the password, as a failed attempt through Better Auth's client", async () => {
    const origin = await refusedWith(403, { code: 'INVALID_ORIGIN', message: 'Invalid origin' })
    const noBody = await gatewayAuth(
      BASE,
      fakeFetch(respondText(403, '<html>forbidden</html>')).fetcher,
    ).signIn(credentials, device)
    const unverified = await refusedWith(403, {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email not verified',
    })

    expect(origin._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(noBody._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(unverified._unsafeUnwrapErr().code).toBe('data:EMAIL_NOT_VERIFIED')
  })
})
