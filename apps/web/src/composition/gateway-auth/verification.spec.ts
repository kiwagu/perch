import { describe, expect, it } from 'vitest'

import { fakeFetch, respond, respondText } from '../__fixtures__/gateway-fetch'
import { namesNone, TOKEN_MARKER } from '../__fixtures__/rejection'

import { gatewayAuth } from './client'
import { verificationOf } from './verification'

const BASE = 'https://app.example.test/backend'

const device = { id: 'device-1', label: 'Chrome on Linux' }

describe('what a refused verification means', () => {
  it('reads a 403 that names account-banned as a banned account, signing nothing in', async () => {
    const refused = (
      await verificationOf(Response.json({ code: 'account-banned' }, { status: 403 }))
    )._unsafeUnwrapErr()

    expect(refused.code).toBe('data:ACCOUNT_BANNED')
  })

  it.each([
    ['another code', respond(403, { code: 'forbidden' })],
    ['no code', respond(403, {})],
    ['no JSON', respondText(403, '<html>forbidden</html>')],
  ] as const)('keeps a 403 with %s a failure naming its status', async (_, answer) => {
    const refused = (await verificationOf(await answer()))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).toMatch(/403/)
  })

  it('names the banned account through the client, and never the link’s token', async () => {
    const { fetcher } = fakeFetch(respond(403, { code: 'account-banned' }))
    const refused = (
      await gatewayAuth(BASE, fetcher).verifyEmail(TOKEN_MARKER, device)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe('data:ACCOUNT_BANNED')
    namesNone(refused, TOKEN_MARKER)
  })
})
