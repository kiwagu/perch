import { describe, expect, it } from 'vitest'

import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { fakeFetch, noContent, respond, respondText } from './__fixtures__/gateway-fetch'
import { organisationsApi } from './organisations-api'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'admin',
}

describe('organisationsApi', () => {
  it('sends the bearer token and the device, and parses a created membership (201)', async () => {
    const { fetcher, sent } = fakeFetch(respond(201, { membership: acme }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })

    expect((await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrap()).toEqual(acme)
    expect(sent).toEqual([
      {
        url: '/backend/organisations',
        method: 'POST',
        authorization: 'Bearer access-1',
        device: 'device-1',
        body: { key: 'acme', name: 'Acme' },
      },
    ])
  })

  it('on 401 renews once through renew() and retries with the new token', async () => {
    const { fetcher, sent } = fakeFetch(
      respond(401, { code: 'unauthorized' }),
      respond(200, { memberships: [acme] }),
    )
    let token = 'old'
    let renewals = 0
    const api = organisationsApi('/backend', {
      token: () => token,
      device: () => 'device-1',
      renew: () => {
        renewals += 1
        token = 'new'

        return Promise.resolve(true)
      },
      fetcher,
    })

    expect((await api.list())._unsafeUnwrap()).toEqual([acme])
    expect(renewals).toBe(1)
    expect(sent.map((request) => request.authorization)).toEqual(['Bearer old', 'Bearer new'])
    expect(sent.map((request) => request.device)).toEqual(['device-1', 'device-1'])
  })

  it('on 401 after a renew gives up with data:AUTH_FAILED', async () => {
    const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(true),
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toHaveLength(2)
  })

  it('on 401 with a renew that fails gives up without a second request', async () => {
    const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toHaveLength(1)
  })

  it('without a token asks nothing and fails with data:AUTH_FAILED', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { memberships: [] }))
    const api = organisationsApi('/backend', {
      token: () => undefined,
      device: () => 'device-1',
      renew: () => Promise.resolve(true),
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toEqual([])
  })

  it.each([
    [400, 'invalid-key'],
    [403, 'not-admin'],
    [404, 'no-such-tenant'],
  ])('maps %i %s to data:WRITE_REJECTED with the code as message', async (status, code) => {
    const { fetcher } = fakeFetch(respond(status, { code }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })

    expect((await api.members('acme'))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_REJECTED',
      message: code,
    })
  })

  it('fails a 2xx answer that is not JSON with data:AUTH_FAILED naming the status, never the body', async () => {
    const { fetcher } = fakeFetch(respondText(200, '<html>an error page</html>'))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })
    const failure = (await api.list())._unsafeUnwrapErr()

    expect(failure.code).toBe('data:AUTH_FAILED')
    expect(failure.message).toContain('200')
    expect(failure.message).not.toContain('html')
  })

  it.each([
    ['is not JSON', respondText(409, '<html>conflict</html>')],
    ['names no code', respond(409, { reason: 'taken' })],
  ])('fails a refusal whose body %s with data:AUTH_FAILED naming the status', async (_, answer) => {
    const { fetcher } = fakeFetch(answer)
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })
    const failure = (await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr()

    expect(failure.code).toBe('data:AUTH_FAILED')
    expect(failure.message).toContain('409')
  })

  it('renews once only when the renewed token is refused too', async () => {
    const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }))
    let renewals = 0
    const api = organisationsApi('/backend', {
      token: () => `access-${renewals + 1}`,
      device: () => 'device-1',
      renew: () => {
        renewals += 1

        return Promise.resolve(true)
      },
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(renewals).toBe(1)
    expect(sent).toHaveLength(2)
  })

  it('gives up with data:AUTH_FAILED, asking nothing more, when the renewal rejects', async () => {
    const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.reject(new Error('the leading tab is gone')),
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toHaveLength(1)
  })

  it('maps 409 key-taken to data:WRITE_REJECTED with the code as message', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'key-taken' }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })
    const refused = (await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:WRITE_REJECTED')
    expect(refused.message).toBe('key-taken')
  })

  it('maps 429 rate-limited to data:WRITE_REJECTED with the code as message', async () => {
    const { fetcher } = fakeFetch(respond(429, { code: 'rate-limited' }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })
    const refused = (await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:WRITE_REJECTED')
    expect(refused.message).toBe('rate-limited')
  })

  it('a fetch that throws is data:OFFLINE', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('names the status of an unexpected answer, never its body', async () => {
    const { fetcher } = fakeFetch(respond(500, { code: 'internal', secret: 'hunter2' }))
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })
    const failed = (await api.list())._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(failed.message).toMatch(/500/)
    expect(failed.message).not.toMatch(/hunter2/)
  })

  it('lists, invites and removes members on the organisation paths', async () => {
    const ann = identityIdFactory.create()
    const member = { identity: { id: ann, email: 'ann@example.test' }, role: 'member' }
    const { fetcher, sent } = fakeFetch(
      respond(200, { members: [member] }),
      respond(200, { member }),
      noContent(),
    )
    const api = organisationsApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(false),
      fetcher,
    })

    expect((await api.members('acme'))._unsafeUnwrap()).toEqual([member])
    expect((await api.invite('acme', 'ann@example.test'))._unsafeUnwrap()).toEqual(member)
    expect((await api.remove('acme', ann)).isOk()).toBe(true)
    expect(sent.map((request) => [request.method, request.url])).toEqual([
      ['GET', '/backend/organisations/acme/members'],
      ['POST', '/backend/organisations/acme/members'],
      ['DELETE', `/backend/organisations/acme/members/${ann}`],
    ])
    expect(sent[1]?.body).toEqual({ email: 'ann@example.test' })
    expect(sent.map((request) => request.device)).toEqual(['device-1', 'device-1', 'device-1'])
  })
})
