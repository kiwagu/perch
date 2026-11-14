import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { fakeFetch, respond, respondText } from '../__fixtures__/gateway-fetch'
import {
  keepsNothingOfTheRejection,
  namesNone,
  PASSWORD_MARKER,
  rejectsCarrying,
  TOKEN_MARKER,
} from '../__fixtures__/rejection'

import { gatewayAuth } from './client'

const BASE = 'https://app.example.test/backend'

describe('gatewayAuth.requestAccountDeletion', () => {
  const session = { token: 'session-token-1', device: 'device-1' }
  const password = 'Secret-old1'

  it('asks with the password, the session token and the device, and nothing else', async () => {
    const recorded = fakeFetch(() => Promise.resolve(new Response(null, { status: 202 })))

    expect(
      (await gatewayAuth(BASE, recorded.fetcher).requestAccountDeletion(password, session)).isOk(),
    ).toBe(true)
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/request-account-deletion`,
        method: 'POST',
        authorization: 'Bearer session-token-1',
        device: 'device-1',
        body: { password },
      },
    ])
  })

  it.each([
    [400, { code: 'invalid-credentials' }, 'data:INVALID_CREDENTIALS'],
    [400, { code: 'bad-request' }, 'data:WRITE_REJECTED'],
    [401, { code: 'unauthorized' }, 'data:AUTH_FAILED'],
    [409, { code: 'last-admin' }, 'data:LAST_ADMIN'],
    [409, { code: 'other' }, 'data:WRITE_FAILED'],
    [409, {}, 'data:WRITE_FAILED'],
    [429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    [500, { code: 'internal' }, 'data:WRITE_FAILED'],
  ])('reads %s %j as %s, naming neither the password nor the token', async (status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (
      await gatewayAuth(BASE, fetcher).requestAccountDeletion(password, session)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, password, session.token)
  })

  it('reads an answer with no JSON body by its status', async () => {
    for (const [answer, code] of [
      [respondText(409, '<html>conflict</html>'), 'data:WRITE_FAILED'],
      [respondText(400, '<html>bad</html>'), 'data:WRITE_REJECTED'],
    ] as const) {
      const { fetcher } = fakeFetch(answer)

      expect(
        (
          await gatewayAuth(BASE, fetcher).requestAccountDeletion(password, session)
        )._unsafeUnwrapErr().code,
      ).toBe(code)
    }
  })

  it('keeps nothing of a rejected request: no cause, no password', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (
        await gatewayAuth(BASE, fetcher).requestAccountDeletion(PASSWORD_MARKER, {
          token: TOKEN_MARKER,
          device: 'device-1',
        })
      )._unsafeUnwrapErr(),
    )
  })
})

describe('gatewayAuth.deleteAccount', () => {
  const token = 'deletion-token-1'

  const identity = identityIdFactory.create()

  it('deletes with the token alone, no credentials and no device, and answers the account', async () => {
    const recorded = fakeFetch(respond(200, { identity }))

    expect(
      (await gatewayAuth(BASE, recorded.fetcher).deleteAccount(token))._unsafeUnwrap(),
    ).toEqual({ identity })
    expect(recorded.sent).toEqual([
      {
        url: `${BASE}/auth/delete-account`,
        method: 'POST',
        authorization: null,
        device: null,
        body: { token },
      },
    ])
  })

  it.each([
    ['an identity that is none', respond(200, { identity: 'not-an-id' })],
    ['no identity', respond(200, {})],
    ['no JSON', respondText(200, 'deleted')],
  ])(
    'fails a 200 that carries %s as an answer that is not the outcome, naming no token',
    async (_what, answer) => {
      const { fetcher } = fakeFetch(answer)
      const refused = (await gatewayAuth(BASE, fetcher).deleteAccount(token))._unsafeUnwrapErr()

      expect(refused.code).toBe('data:AUTH_FAILED')
      namesNone(refused, token)
    },
  )

  it('refuses an empty token as a link that does not work, without asking the gateway', async () => {
    const recorded = fakeFetch(respond(200, {}))

    expect(
      (await gatewayAuth(BASE, recorded.fetcher).deleteAccount(''))._unsafeUnwrapErr().code,
    ).toBe('data:LINK_INVALID')
    expect(recorded.sent).toEqual([])
  })

  it.each([
    [400, { code: 'bad-request' }, 'data:LINK_INVALID'],
    [401, { code: 'link-expired' }, 'data:LINK_EXPIRED'],
    [401, { code: 'link-invalid' }, 'data:LINK_INVALID'],
    [401, {}, 'data:LINK_INVALID'],
    [409, { code: 'last-admin' }, 'data:LAST_ADMIN'],
    [409, {}, 'data:AUTH_FAILED'],
    [429, { code: 'rate-limited' }, 'data:RATE_LIMITED'],
    [500, { code: 'internal' }, 'data:AUTH_FAILED'],
  ])('reads %s %j as %s, naming no token', async (status, body, code) => {
    const { fetcher } = fakeFetch(respond(status, body))
    const refused = (await gatewayAuth(BASE, fetcher).deleteAccount(token))._unsafeUnwrapErr()

    expect(refused.code).toBe(code)
    namesNone(refused, token)
  })

  it('keeps nothing of a rejected request: no cause, no token', async () => {
    const { fetcher } = fakeFetch(rejectsCarrying())

    keepsNothingOfTheRejection(
      (await gatewayAuth(BASE, fetcher).deleteAccount(TOKEN_MARKER))._unsafeUnwrapErr(),
    )
  })
})
