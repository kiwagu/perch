import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import { type Fetcher, gatewayAuth } from './gateway-auth'

const input = { email: 'ann@example.test', password: 'pass-word-1' }

const signedIn = {
  identity: { id: identityIdFactory.create(), email: input.email },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
}

interface Sent {
  readonly url: string
  readonly method: string | undefined
  readonly body: unknown
}

/** A `fetch` that answers every request with `answer` and records what was sent. */
function fakeFetch(answer: () => Promise<Response>) {
  const sent: Sent[] = []
  const fetcher: Fetcher = async (url, init) => {
    sent.push({
      url,
      method: init.method,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    return answer()
  }

  return { fetcher, sent }
}

const respond = (status: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status }))

describe('gatewayAuth', () => {
  it('signs up with a POST to the gateway and answers with the identity and its keys', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))
    const device = (
      await gatewayAuth('https://app.example.test/backend', fetcher).signUp(input)
    )._unsafeUnwrap()

    expect(device).toEqual(signedIn)
    expect(sent).toEqual([
      { url: 'https://app.example.test/backend/auth/sign-up', method: 'POST', body: input },
    ])
  })

  it('signs in at its own path', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect((await gatewayAuth('/backend', fetcher).signIn(input))._unsafeUnwrap()).toEqual(signedIn)
    expect(sent[0]?.url).toBe('/backend/auth/sign-in')
  })

  it('reads 401 as wrong credentials', async () => {
    const { fetcher } = fakeFetch(respond(401, { code: 'invalid-credentials' }))

    expect((await gatewayAuth('/backend', fetcher).signIn(input))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CREDENTIALS',
    )
  })

  it('reads 409 as a refused sign-up', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'sign-up-rejected' }))

    expect((await gatewayAuth('/backend', fetcher).signUp(input))._unsafeUnwrapErr().code).toBe(
      'data:SIGN_UP_REJECTED',
    )
  })

  it('reads 400 as a request the gateway could not take', async () => {
    const { fetcher } = fakeFetch(respond(400, { code: 'bad-request' }))
    const refused = (await gatewayAuth('/backend', fetcher).signUp(input))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).toMatch(/400/)
  })

  it('is offline when the gateway cannot be reached', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect((await gatewayAuth('/backend', fetcher).signIn(input))._unsafeUnwrapErr().code).toBe(
      'data:OFFLINE',
    )
  })

  it('fails when the answer is not what the gateway promises', async () => {
    const wrongShape = fakeFetch(respond(200, { identity: { id: 'idn_x' }, tokens: {} }))
    const notJson = fakeFetch(() => Promise.resolve(new Response('<html>', { status: 200 })))

    expect(
      (await gatewayAuth('/backend', wrongShape.fetcher).signIn(input))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
    expect(
      (await gatewayAuth('/backend', notJson.fetcher).signIn(input))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })
})
