import { describe, expect, it } from 'vitest'

import { fakeFetch, noContent, respond } from '../__fixtures__/gateway-fetch'
import {
  EMAIL_MARKER,
  keepsNothingOfTheRejection,
  namesNone,
  PASSWORD_MARKER,
  rejectsCarrying,
  TOKEN_MARKER,
} from '../__fixtures__/rejection'

import { gatewayAuth } from './client'

const BASE = 'https://app.example.test/backend'

/** An answer without a body that accepts the request (202). */
const accepted = () => () => Promise.resolve(new Response(null, { status: 202 }))

describe('gatewayAuth.requestPasswordReset', () => {
  const email = 'Ann@example.test'

  it('asks for the reset mail with the email alone, no credentials and no device', async () => {
    const recorded = fakeFetch(accepted())

    expect((await gatewayAuth(BASE, recorded.fetcher).requestPasswordReset(email)).isOk()).toBe(
      true,
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/request-password-reset`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { email },
      },
    ])
  })

  it('reads 429 as a request to wait, another 4xx as a refusal and a failure as one to ask again', async () => {
    for (const [status, code] of [
      [429, 'data:RATE_LIMITED'],
      [400, 'data:WRITE_REJECTED'],
      [500, 'data:WRITE_FAILED'],
    ] as const) {
      const { fetcher } = fakeFetch(respond(status, { code: 'bad-request' }))
      const refused = (
        await gatewayAuth(BASE, fetcher).requestPasswordReset(email)
      )._unsafeUnwrapErr()

      expect(refused.code).toBe(code)
      namesNone(refused, email, email.toLowerCase())
    }
  })

  it('keeps nothing of a rejected request: no cause, no email', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (await gatewayAuth(BASE, fetcher).requestPasswordReset(EMAIL_MARKER))._unsafeUnwrapErr(),
    )
  })
})

describe('gatewayAuth.resetPassword', () => {
  const token = 'reset-token-1'
  const password = 'Secret-new1'

  it('sets the new password with the token alone, no credentials and no device', async () => {
    const recorded = fakeFetch(noContent())

    expect((await gatewayAuth(BASE, recorded.fetcher).resetPassword(token, password)).isOk()).toBe(
      true,
    )
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/reset-password`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { token, password },
      },
    ])
  })

  it('refuses an empty token as a link that does not work, without asking the gateway', async () => {
    const recorded = fakeFetch(noContent())

    expect(
      (await gatewayAuth(BASE, recorded.fetcher).resetPassword('', password))._unsafeUnwrapErr()
        .code,
    ).toBe('data:LINK_INVALID')
    expect(recorded.sent).toEqual([])
  })

  it.each([
    [400, { code: 'password-rejected' }, 'data:PASSWORD_REJECTED'],
    [400, { code: 'bad-request' }, 'data:WRITE_REJECTED'],
    [401, { code: 'link-expired' }, 'data:LINK_EXPIRED'],
    [401, { code: 'link-invalid' }, 'data:LINK_INVALID'],
    [401, {}, 'data:LINK_INVALID'],
    [429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    [500, { code: 'internal' }, 'data:AUTH_FAILED'],
  ])('reads %s %j as %s, naming neither the token nor the password', async (status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (
      await gatewayAuth(BASE, fetcher).resetPassword(token, password)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, token, password)
  })

  it('keeps nothing of a rejected request: no cause, no token, no password', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (
        await gatewayAuth(BASE, fetcher).resetPassword(TOKEN_MARKER, PASSWORD_MARKER)
      )._unsafeUnwrapErr(),
    )
  })
})
