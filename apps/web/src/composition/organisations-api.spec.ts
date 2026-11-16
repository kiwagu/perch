import { describe, expect, it } from 'vitest'

import { identityIdFactory, invitationIdFactory, tenantIdFactory } from '@workspace/ids'
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
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })

    expect((await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrap()).toEqual(acme)
    expect(sent).toEqual([
      {
        url: '/backend/organisations',
        method: 'POST',
        authorization: 'Bearer token-1',
        device: 'device-1',
        body: { key: 'acme', name: 'Acme' },
      },
    ])
  })

  it('on 401 gives up with data:AUTH_FAILED without a second request: the token is dead', async () => {
    const { fetcher, sent } = fakeFetch(
      respond(401, { code: 'unauthorized' }),
      respond(200, { memberships: [acme] }),
    )
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })
    const refused = (await api.list())._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).toBe('the gateway refused the session token')
    expect(sent).toHaveLength(1)
  })

  it('without a token asks nothing and fails with data:AUTH_FAILED', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { memberships: [] }))
    const api = organisationsApi('/backend', {
      token: () => undefined,
      device: () => 'device-1',
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
      token: () => 'token-1',
      device: () => 'device-1',
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
      token: () => 'token-1',
      device: () => 'device-1',
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
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })
    const failure = (await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr()

    // The status, never the body.
    expect(failure.code).toBe('data:AUTH_FAILED')
    expect(failure.message).toBe('the gateway answered 409 with something unexpected')
  })

  it('maps 409 key-taken to data:WRITE_REJECTED with the code as message', async () => {
    const { fetcher } = fakeFetch(respond(409, { code: 'key-taken' }))
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })
    const refused = (await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:WRITE_REJECTED')
    expect(refused.message).toBe('key-taken')
  })

  it('maps 429 rate-limited to data:WRITE_REJECTED with the code as message', async () => {
    const { fetcher } = fakeFetch(respond(429, { code: 'rate-limited' }))
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })
    const refused = (await api.create({ key: 'acme', name: 'Acme' }))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:WRITE_REJECTED')
    expect(refused.message).toBe('rate-limited')
  })

  it('a fetch that throws is data:OFFLINE', async () => {
    const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })

    expect((await api.list())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })

  it('names the status of an unexpected answer, never its body', async () => {
    const { fetcher } = fakeFetch(respond(500, { code: 'internal', secret: 'hunter2' }))
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })
    const failed = (await api.list())._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(failed.message).toMatch(/500/)
    expect(failed.message).not.toMatch(/hunter2/)
  })

  it('lists and removes members on the organisation paths, and changes a role by a PATCH answered 204', async () => {
    const ann = identityIdFactory.create()
    const member = { identity: { id: ann, email: 'ann@example.test' }, role: 'member' }
    const { fetcher, sent } = fakeFetch(
      respond(200, { members: [member] }),
      noContent(),
      noContent(),
    )
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })

    expect((await api.members('acme'))._unsafeUnwrap()).toEqual([member])
    expect((await api.setRole('acme', ann, 'admin')).isOk()).toBe(true)
    expect((await api.remove('acme', ann)).isOk()).toBe(true)
    expect(sent.map((request) => [request.method, request.url])).toEqual([
      ['GET', '/backend/organisations/acme/members'],
      ['PATCH', `/backend/organisations/acme/members/${ann}`],
      ['DELETE', `/backend/organisations/acme/members/${ann}`],
    ])
    expect(sent[1]?.body).toEqual({ role: 'admin' })
    expect(sent.map((request) => request.device)).toEqual(['device-1', 'device-1', 'device-1'])
  })

  it('invites an email with a role on the invitations path (201) and parses the invitation with its link', async () => {
    const id = invitationIdFactory.create()
    const invitation = {
      id,
      email: 'ann@example.test',
      role: 'admin',
      link: 'https://perch.example.test/invitation?token=abc',
    }
    const { fetcher, sent } = fakeFetch(respond(201, { invitation }))
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })

    expect((await api.invite('acme', 'ann@example.test', 'admin'))._unsafeUnwrap()).toEqual(
      invitation,
    )
    expect(sent).toEqual([
      {
        url: '/backend/organisations/acme/invitations',
        method: 'POST',
        authorization: 'Bearer token-1',
        device: 'device-1',
        body: { email: 'ann@example.test', role: 'admin' },
      },
    ])
  })

  it('lists the pending invitations newest first as the gateway sends them, and revokes one by its id', async () => {
    const [first, second] = [invitationIdFactory.create(), invitationIdFactory.create()]
    const pending = [
      {
        id: first,
        email: 'bea@example.test',
        role: 'member',
        link: 'https://perch.example.test/invitation?token=b',
      },
      {
        id: second,
        email: 'ann@example.test',
        role: 'admin',
        link: 'https://perch.example.test/invitation?token=a',
      },
    ]
    const { fetcher, sent } = fakeFetch(respond(200, { invitations: pending }), noContent())
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })

    expect((await api.invitations('acme'))._unsafeUnwrap()).toEqual(pending)
    expect((await api.revokeInvitation('acme', first)).isOk()).toBe(true)
    expect(sent.map((request) => [request.method, request.url])).toEqual([
      ['GET', '/backend/organisations/acme/invitations'],
      ['DELETE', `/backend/organisations/acme/invitations/${first}`],
    ])
  })

  it('never posts to the members path to add one: an invite goes to the invitations', async () => {
    const { fetcher, sent } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const api = organisationsApi('/backend', {
      token: () => 'token-1',
      device: () => 'device-1',
      fetcher,
    })

    expect((await api.invite('acme', 'ann@example.test', 'member')).isErr()).toBe(true)
    expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
      'POST /backend/organisations/acme/invitations',
    ])
  })

  it.each([
    ['invite', 400, 'email-invalid'],
    ['invite', 409, 'already-member'],
    ['invite', 429, 'rate-limited'],
    ['setRole', 409, 'last-admin'],
    ['setRole', 404, 'no-such-member'],
    ['setRole', 403, 'not-admin'],
  ] as const)(
    'maps the %s refusal %i %s to data:WRITE_REJECTED with the code as message',
    async (call, status, code) => {
      const { fetcher } = fakeFetch(respond(status, { code }))
      const api = organisationsApi('/backend', {
        token: () => 'token-1',
        device: () => 'device-1',
        fetcher,
      })
      const refused =
        call === 'invite'
          ? await api.invite('acme', 'ann@example.test', 'member')
          : await api.setRole('acme', identityIdFactory.create(), 'member')

      expect(refused._unsafeUnwrapErr()).toMatchObject({
        code: 'data:WRITE_REJECTED',
        message: code,
      })
    },
  )
})
