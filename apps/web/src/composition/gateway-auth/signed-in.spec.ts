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

  it.each([
    ['the code of Better Auth', 'EMAIL_NOT_VERIFIED'],
    ['the gateway’s own code', 'email-not-verified'],
    ['a code nobody knows', 'something-else'],
    ['a code that is no string', 42],
    ['no code', undefined],
  ] as const)('keeps reading a 403 with %s as an email not verified yet', async (_, code) => {
    expect((await signedIn(refusal(403, code)))._unsafeUnwrapErr().code).toBe(
      'data:EMAIL_NOT_VERIFIED',
    )
  })

  it('reads the code only of a 403: the other refusals keep their meaning', async () => {
    for (const [status, code] of [
      [401, 'data:INVALID_CREDENTIALS'],
      [409, 'data:DEVICE_LIMIT'],
      [429, 'data:RATE_LIMITED'],
      [500, 'data:AUTH_FAILED'],
    ] as const) {
      expect((await signedIn(refusal(status, 'account-banned')))._unsafeUnwrapErr().code).toBe(code)
    }
  })

  it("carries the body's code through Better Auth's client: 403 account-banned is a banned account", async () => {
    const refused = (await refusedWith(403, { code: 'account-banned' }))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:ACCOUNT_BANNED')
    namesNone(refused, credentials.email, credentials.password)
  })

  it("keeps a 403 whose body names another code, or is no JSON, an email not verified yet through Better Auth's client", async () => {
    const other = await refusedWith(403, {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Email not verified',
    })
    const noBody = await gatewayAuth(
      BASE,
      fakeFetch(respondText(403, '<html>forbidden</html>')).fetcher,
    ).signIn(credentials, device)

    expect(other._unsafeUnwrapErr().code).toBe('data:EMAIL_NOT_VERIFIED')
    expect(noBody._unsafeUnwrapErr().code).toBe('data:EMAIL_NOT_VERIFIED')
  })
})
