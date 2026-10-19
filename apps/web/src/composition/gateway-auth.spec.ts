import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { type Fetcher, gatewayAuth } from './gateway-auth'

const input = { email: 'ann@example.test', password: 'pass-word-1' }

const device = { id: 'device-1', label: 'Chrome on Linux' }

const pair = { access: 'access-1', refresh: 'refresh-1' }

const signedIn = {
  identity: { id: identityIdFactory.create(), email: input.email },
  tokens: { access: 'access-1', refresh: 'refresh-1' },
  memberships: [] as Membership[],
}

interface Sent {
  readonly url: string
  readonly method: string | undefined
  readonly body: unknown
  readonly device: string | null
  readonly authorization: string | null
}

/** A `fetch` that answers every request with `answer` and records what was sent. */
function fakeFetch(answer: () => Promise<Response>) {
  const sent: Sent[] = []
  const fetcher: Fetcher = async (url, init) => {
    const headers = new Headers(init.headers)

    sent.push({
      url,
      method: init.method,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      device: headers.get('X-Perch-Device'),
      authorization: headers.get('Authorization'),
    })

    return answer()
  }

  return { fetcher, sent }
}

const respond = (status: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status }))

describe('gatewayAuth', () => {
  it('signs up with a POST to the gateway naming the device, and answers with the identity and its keys', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))
    const answer = (
      await gatewayAuth('https://app.example.test/backend', fetcher).signUp(input, device)
    )._unsafeUnwrap()

    expect(answer).toEqual(signedIn)
    expect(sent).toEqual([
      {
        url: 'https://app.example.test/backend/auth/sign-up',
        method: 'POST',
        body: { ...input, device },
        device: null,
        authorization: null,
      },
    ])
  })

  it('signs in at its own path, naming the device', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, signedIn))

    expect((await gatewayAuth('/backend', fetcher).signIn(input, device))._unsafeUnwrap()).toEqual(
      signedIn,
    )
    expect(sent[0]?.url).toBe('/backend/auth/sign-in')
    expect(sent[0]?.body).toEqual({ ...input, device })
  })

  it('reads 401 as wrong credentials', async () => {
    const { fetcher } = fakeFetch(respond(401, { code: 'invalid-credentials' }))

    expect(
      (await gatewayAuth('/backend', fetcher).signIn(input, device))._unsafeUnwrapErr().code,
    ).toBe('data:INVALID_CREDENTIALS')
  })

  it('reads 409 as a refused sign-up', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'sign-up-rejected' }))

    expect(
      (await gatewayAuth('/backend', fetcher).signUp(input, device))._unsafeUnwrapErr().code,
    ).toBe('data:SIGN_UP_REJECTED')
  })

  it('reads 400 as a request the gateway could not take', async () => {
    const { fetcher } = fakeFetch(respond(400, { code: 'bad-request' }))
    const refused = (
      await gatewayAuth('/backend', fetcher).signUp(input, device)
    )._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).toMatch(/400/)
  })

  it('is offline when the gateway cannot be reached', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(
      (await gatewayAuth('/backend', fetcher).signIn(input, device))._unsafeUnwrapErr().code,
    ).toBe('data:OFFLINE')
  })

  it('fails when the answer is not what the gateway promises', async () => {
    const wrongShape = fakeFetch(respond(200, { identity: { id: 'idn_x' }, tokens: {} }))
    const notJson = fakeFetch(() => Promise.resolve(new Response('<html>', { status: 200 })))

    expect(
      (await gatewayAuth('/backend', wrongShape.fetcher).signIn(input, device))._unsafeUnwrapErr()
        .code,
    ).toBe('data:AUTH_FAILED')
    expect(
      (await gatewayAuth('/backend', notJson.fetcher).signIn(input, device))._unsafeUnwrapErr()
        .code,
    ).toBe('data:AUTH_FAILED')
  })

  it('parses the memberships of the answer', async () => {
    const acme: Membership = {
      tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
      role: 'member',
    }
    const { fetcher } = fakeFetch(respond(200, { ...signedIn, memberships: [acme] }))
    const answer = (await gatewayAuth('/backend', fetcher).signIn(input, device))._unsafeUnwrap()

    expect(answer.memberships).toEqual([acme])
  })

  it('refuses an answer without memberships as data:AUTH_FAILED', async () => {
    const { fetcher } = fakeFetch(
      respond(200, { identity: signedIn.identity, tokens: signedIn.tokens }),
    )

    expect(
      (await gatewayAuth('/backend', fetcher).signIn(input, device))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('signs a pair out with a POST naming the device, the pair in the body and no bearer token', async () => {
    const { fetcher, sent } = fakeFetch(() => Promise.resolve(new Response(null, { status: 204 })))

    expect((await gatewayAuth('/backend', fetcher).signOut(pair, 'device-1')).isOk()).toBe(true)
    expect(sent).toEqual([
      {
        url: '/backend/auth/sign-out',
        method: 'POST',
        body: pair,
        device: 'device-1',
        authorization: null,
      },
    ])
  })

  it('reads 401 to a sign-out as a pair that signs nobody in any more', async () => {
    const { fetcher } = fakeFetch(respond(401, { code: 'unauthorized' }))

    expect(
      (await gatewayAuth('/backend', fetcher).signOut(pair, 'device-1'))._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('reads another 4xx to a sign-out as a refusal the gateway will never take back', async () => {
    for (const status of [400, 404]) {
      const { fetcher } = fakeFetch(respond(status, { code: 'bad-request' }))
      const refused = (
        await gatewayAuth('/backend', fetcher).signOut(pair, 'device-1')
      )._unsafeUnwrapErr()

      expect(refused.code).toBe('data:WRITE_REJECTED')
      expect(refused.message).toMatch(new RegExp(String(status)))
      expect(refused.message).not.toMatch(/access-1|refresh-1/)
    }
  })

  it('fails a sign-out the gateway could not complete with its status, never the pair', async () => {
    const { fetcher } = fakeFetch(respond(500, { code: 'internal' }))
    const failed = (
      await gatewayAuth('/backend', fetcher).signOut(pair, 'device-1')
    )._unsafeUnwrapErr()

    expect(failed.code).toBe('data:WRITE_FAILED')
    expect(failed.message).toMatch(/500/)
    expect(failed.message).not.toMatch(/access-1|refresh-1/)
  })

  it('is offline when a sign-out cannot reach the gateway', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(
      (await gatewayAuth('/backend', fetcher).signOut(pair, 'device-1'))._unsafeUnwrapErr().code,
    ).toBe('data:OFFLINE')
  })
})
