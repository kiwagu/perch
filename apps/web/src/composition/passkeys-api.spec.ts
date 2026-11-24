import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { passkeyIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond } from './__fixtures__/gateway-fetch'
import type { PasskeyCeremony } from './passkey-ceremony'
import { passkeysApi } from './passkeys-api'

const laptop = passkeyIdFactory.create()
const key = passkeyIdFactory.create()

const creationOptions = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'Perch', id: 'app.example.test' },
  user: { id: 'dXNlcg', name: 'ann@example.test', displayName: 'Ann' },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }],
}

const challenge = 'better-auth-passkey=abc.def%2Bghi'

const attestation = {
  id: 'credential-1',
  rawId: 'AQID',
  type: 'public-key' as const,
  clientExtensionResults: {},
  response: { attestationObject: 'CA', clientDataJSON: 'BQ' },
}

/** A ceremony whose browser makes `attestation`, recording the options it was asked with. */
function makingCeremony(asked: unknown[] = []): PasskeyCeremony {
  return {
    register: (options) => {
      asked.push(options)

      return okAsync(attestation)
    },
    authenticate: () => errAsync(dataError('data:AUTH_FAILED', 'not in this test')),
  }
}

/** The client over `fetcher` and `ceremony`, with the session token `token()` and the device `device-1`. */
function api(
  fetcher: ReturnType<typeof fakeFetch>['fetcher'],
  ceremony: PasskeyCeremony = makingCeremony(),
  token: () => string | undefined = () => 'token-1',
) {
  return passkeysApi('/backend', { token, device: () => 'device-1', fetcher }, ceremony)
}

const bearer = (method: string, url: string, body?: unknown) => ({
  url: `/backend${url}`,
  method,
  authorization: 'Bearer token-1',
  device: 'device-1',
  body,
})

describe('passkeysApi', () => {
  it("lists the account's passkeys with their times as dates", async () => {
    const { fetcher, sent } = fakeFetch(
      respond(200, [
        { id: laptop, createdAt: '2026-11-01T08:00:00.000Z' },
        { id: key, createdAt: '2026-11-02T09:30:00.000Z' },
      ]),
    )

    expect((await api(fetcher).list())._unsafeUnwrap()).toEqual([
      { id: laptop, createdAt: new Date('2026-11-01T08:00:00.000Z') },
      { id: key, createdAt: new Date('2026-11-02T09:30:00.000Z') },
    ])
    expect(sent).toEqual([bearer('GET', '/passkeys')])
  })

  it('refuses a list with an entry that is no passkey', async () => {
    const { fetcher } = fakeFetch(respond(200, [{ id: 'abc', createdAt: 'yesterday' }]))

    expect((await api(fetcher).list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it("adds a passkey: asks the gateway for the options, has the browser make one with them, and sends what it made with the options' challenge", async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { options: creationOptions, challenge }), () =>
      Promise.resolve(new Response(null, { status: 201 })),
    )
    const asked: unknown[] = []

    expect((await api(fetcher, makingCeremony(asked)).add())._unsafeUnwrap()).toBeUndefined()
    expect(asked).toEqual([creationOptions])
    expect(sent).toEqual([
      bearer('POST', '/passkeys/options'),
      bearer('POST', '/passkeys', { response: attestation, challenge }),
    ])
  })

  it('adds nothing when the window is closed or times out: data:PASSKEY_CANCELLED, and the gateway is asked for no passkey', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { options: creationOptions, challenge }))
    const cancelled: PasskeyCeremony = {
      register: () => errAsync(dataError('data:PASSKEY_CANCELLED', 'closed')),
      authenticate: () => errAsync(dataError('data:AUTH_FAILED', 'not in this test')),
    }

    expect((await api(fetcher, cancelled).add())._unsafeUnwrapErr().code).toBe(
      'data:PASSKEY_CANCELLED',
    )
    expect(sent.map(({ url }) => url)).toEqual(['/backend/passkeys/options'])
  })

  it.each([
    ['no options', { challenge }],
    ['options without a challenge', { options: { ...creationOptions, challenge: '' }, challenge }],
    ['no challenge', { options: creationOptions }],
  ])('refuses options with %s, before the browser is asked', async (_, body) => {
    const asked: unknown[] = []
    const { fetcher } = fakeFetch(respond(200, body))

    expect((await api(fetcher, makingCeremony(asked)).add())._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
    expect(asked).toEqual([])
  })

  it('fails as the gateway refused the passkey the browser made: nothing is added', async () => {
    const { fetcher } = fakeFetch(
      respond(200, { options: creationOptions, challenge }),
      respond(400, { code: 'failed' }),
    )

    expect((await api(fetcher).add())._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })

  it('removes a passkey by its id', async () => {
    const { fetcher, sent } = fakeFetch(noContent())

    expect((await api(fetcher).remove(laptop))._unsafeUnwrap()).toBeUndefined()
    expect(sent).toEqual([bearer('DELETE', `/passkeys/${laptop}`)])
  })

  it('fails as a refusal when the passkey is none of the account', async () => {
    const { fetcher } = fakeFetch(respond(404, { code: 'failed' }))

    expect((await api(fetcher).remove(laptop))._unsafeUnwrapErr().code).toBe('data:WRITE_REJECTED')
  })

  it('on 401 gives up with data:AUTH_FAILED without a second request: the token is dead', async () => {
    const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }), noContent())

    expect((await api(fetcher).remove(laptop))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toHaveLength(1)
  })

  it('fails as data:OFFLINE when the gateway cannot be reached', async () => {
    const down = api(() => Promise.reject(new Error('down')))

    expect((await down.list())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })
})
