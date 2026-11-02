import { describe, expect, it } from 'vitest'

import { fakeFetch, respond } from '../__fixtures__/gateway-fetch'
import {
  EMAIL_MARKER,
  keepsNothingOfTheRejection,
  namesNone,
  rejectsCarrying,
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
