import { describe, expect, it } from 'vitest'

import { invitationIdFactory, tenantIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { fakeFetch, noContent, respond, respondText } from './__fixtures__/gateway-fetch'
import { invitationsApi } from './invitations-api'

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: 'member',
}

const signedIn = {
  token: () => 'token-1' as string | undefined,
  device: () => 'device-1',
}

const guest = {
  token: () => undefined as string | undefined,
  device: () => {
    throw new Error('a guest names no device')
  },
}

describe('invitationsApi', () => {
  describe('read', () => {
    it("posts the link's token in the body, not the path, and parses the organisation, the role and forYou", async () => {
      const { fetcher, sent } = fakeFetch(
        respond(200, {
          invitation: { organisation: { name: 'Acme' }, role: 'admin', forYou: true },
        }),
      )
      const api = invitationsApi('/backend', { ...signedIn, fetcher })

      expect((await api.read('link-token'))._unsafeUnwrap()).toEqual({
        organisation: { name: 'Acme' },
        role: 'admin',
        forYou: true,
      })
      expect(sent).toEqual([
        {
          url: '/backend/invitations/read',
          method: 'POST',
          authorization: 'Bearer token-1',
          device: 'device-1',
          body: { token: 'link-token' },
        },
      ])
    })

    it('sends no Authorization and no device when the device holds no session, and asks anyway', async () => {
      const { fetcher, sent } = fakeFetch(
        respond(200, {
          invitation: { organisation: { name: 'Acme' }, role: 'member', forYou: false },
        }),
      )
      const api = invitationsApi('/backend', { ...guest, fetcher })

      expect((await api.read('link-token'))._unsafeUnwrap()).toEqual({
        organisation: { name: 'Acme' },
        role: 'member',
        forYou: false,
      })
      expect(sent).toEqual([
        {
          url: '/backend/invitations/read',
          method: 'POST',
          authorization: null,
          device: null,
          body: { token: 'link-token' },
        },
      ])
    })

    it('gives up with data:AUTH_FAILED on the 401 of a token it sent: that token is dead', async () => {
      const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }))
      const api = invitationsApi('/backend', { ...signedIn, fetcher })
      const refused = (await api.read('link-token'))._unsafeUnwrapErr()

      expect(refused.code).toBe('data:AUTH_FAILED')
      expect(refused.message).toBe('the gateway refused the session token')
      expect(sent).toHaveLength(1)
    })

    it.each([
      [404, 'link-invalid'],
      [410, 'link-expired'],
      [429, 'rate-limited'],
      [400, 'bad-request'],
    ])(
      'maps %i %s to data:WRITE_REJECTED with the code as message, signed in or not',
      async (status, code) => {
        for (const deps of [signedIn, guest]) {
          const { fetcher } = fakeFetch(respond(status, { code }))
          const api = invitationsApi('/backend', { ...deps, fetcher })

          expect((await api.read('link-token'))._unsafeUnwrapErr()).toMatchObject({
            code: 'data:WRITE_REJECTED',
            message: code,
          })
        }
      },
    )

    it('fails an answer that is not what the gateway sends with data:AUTH_FAILED naming the status, never the body', async () => {
      const { fetcher } = fakeFetch(
        respond(200, {
          invitation: { organisation: { name: 'Acme' }, role: 'owner', forYou: 'yes' },
        }),
      )
      const failure = (
        await invitationsApi('/backend', { ...guest, fetcher }).read('t')
      )._unsafeUnwrapErr()

      expect(failure).toMatchObject({
        code: 'data:AUTH_FAILED',
        message: 'the gateway answered 200 with something unexpected',
      })
    })

    it('a fetch that throws is data:OFFLINE', async () => {
      const { fetcher } = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

      expect(
        (await invitationsApi('/backend', { ...guest, fetcher }).read('t'))._unsafeUnwrapErr().code,
      ).toBe('data:OFFLINE')
    })
  })

  describe('mine', () => {
    it("lists the invitations of the signed-in account with the organisation's name and the role", async () => {
      const first = invitationIdFactory.create()
      const second = invitationIdFactory.create()
      const listed = [
        { id: first, organisation: { name: 'Zeta' }, role: 'admin' },
        { id: second, organisation: { name: 'Acme' }, role: 'member' },
      ]
      const { fetcher, sent } = fakeFetch(respond(200, { invitations: listed }))
      const api = invitationsApi('/backend', { ...signedIn, fetcher })

      expect((await api.mine())._unsafeUnwrap()).toEqual(listed)
      expect(sent).toEqual([
        {
          url: '/backend/invitations',
          method: 'GET',
          authorization: 'Bearer token-1',
          device: 'device-1',
          body: undefined,
        },
      ])
    })

    it('without a token asks nothing and fails with data:AUTH_FAILED', async () => {
      const { fetcher, sent } = fakeFetch(respond(200, { invitations: [] }))
      const api = invitationsApi('/backend', { ...guest, fetcher })

      expect((await api.mine())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
      expect(sent).toEqual([])
    })

    it("fails an id that is no invitation's", async () => {
      const { fetcher } = fakeFetch(
        respond(200, {
          invitations: [{ id: 'not-an-id', organisation: { name: 'Acme' }, role: 'member' }],
        }),
      )

      expect(
        (await invitationsApi('/backend', { ...signedIn, fetcher }).mine())._unsafeUnwrapErr().code,
      ).toBe('data:AUTH_FAILED')
    })
  })

  describe('accept and decline', () => {
    it("accepts by the invitation's id and parses the membership", async () => {
      const id = invitationIdFactory.create()
      const { fetcher, sent } = fakeFetch(respond(200, { membership: acme }))
      const api = invitationsApi('/backend', { ...signedIn, fetcher })

      expect((await api.accept(id))._unsafeUnwrap()).toEqual(acme)
      expect(sent).toEqual([
        {
          url: '/backend/invitations/accept',
          method: 'POST',
          authorization: 'Bearer token-1',
          device: 'device-1',
          body: { invitation: id },
        },
      ])
    })

    it('declines by the same body and answers nothing (204)', async () => {
      const id = invitationIdFactory.create()
      const { fetcher, sent } = fakeFetch(noContent())
      const api = invitationsApi('/backend', { ...signedIn, fetcher })

      expect((await api.decline(id)).isOk()).toBe(true)
      expect(sent.map((request) => [request.method, request.url, request.body])).toEqual([
        ['POST', '/backend/invitations/decline', { invitation: id }],
      ])
    })

    it.each([
      [403, 'other-account'],
      [409, 'already-member'],
      [410, 'invitation-gone'],
    ])(
      'maps %i %s of an accept and a decline to data:WRITE_REJECTED with the code as message',
      async (status, code) => {
        for (const call of ['accept', 'decline'] as const) {
          const { fetcher } = fakeFetch(respond(status, { code }))
          const api = invitationsApi('/backend', { ...signedIn, fetcher })

          expect((await api[call]('inv'))._unsafeUnwrapErr()).toMatchObject({
            code: 'data:WRITE_REJECTED',
            message: code,
          })
        }
      },
    )

    it('on 401 gives up with data:AUTH_FAILED: the account is gone or the token dead', async () => {
      const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }), noContent())
      const api = invitationsApi('/backend', { ...signedIn, fetcher })

      expect((await api.accept('inv'))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
      expect(sent).toHaveLength(1)
    })

    it('without a token asks nothing, for an accept as for a decline', async () => {
      const { fetcher, sent } = fakeFetch(noContent())
      const api = invitationsApi('/backend', { ...guest, fetcher })

      expect((await api.accept('inv'))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
      expect((await api.decline('inv'))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
      expect(sent).toEqual([])
    })

    it('fails a 410 that names no code with data:AUTH_FAILED naming the status', async () => {
      const { fetcher } = fakeFetch(respondText(410, '<html>gone</html>'))
      const failure = (
        await invitationsApi('/backend', { ...signedIn, fetcher }).accept('inv')
      )._unsafeUnwrapErr()

      expect(failure).toMatchObject({
        code: 'data:AUTH_FAILED',
        message: 'the gateway answered 410 with something unexpected',
      })
    })
  })
})
