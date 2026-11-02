import { describe, expect, it } from 'vitest'

import { device_sessionIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond } from './__fixtures__/gateway-fetch'
import { devicesApi } from './devices-api'

const laptop = device_sessionIdFactory.create()
const phone = device_sessionIdFactory.create()

/** Ann's devices as the gateway lists them to her laptop: the phone signed out from it. */
const listed = {
  devices: [
    {
      id: laptop,
      label: 'Firefox on Linux',
      createdAt: '2026-10-01T08:00:00.000Z',
      lastSeenAt: '2026-10-18T09:30:00.000Z',
      revokedAt: null,
      current: true,
    },
    {
      id: phone,
      label: 'Safari on iPhone',
      createdAt: '2026-10-02T10:00:00.000Z',
      lastSeenAt: '2026-10-17T21:15:00.000Z',
      revokedAt: '2026-10-18T09:00:00.000Z',
      current: false,
    },
  ],
}

/** The client over `fetcher`, with the session token `token()` and the device `device-1`. */
function api(
  fetcher: ReturnType<typeof fakeFetch>['fetcher'],
  token: () => string | undefined = () => 'token-1',
) {
  return devicesApi('/backend', { token, device: () => 'device-1', fetcher })
}

describe('devicesApi', () => {
  it("reads the identity's devices with the bearer token and the device, their times as dates", async () => {
    const { fetcher, sent } = fakeFetch(respond(200, listed))

    expect((await api(fetcher).list())._unsafeUnwrap()).toEqual([
      {
        id: laptop,
        label: 'Firefox on Linux',
        createdAt: new Date('2026-10-01T08:00:00.000Z'),
        lastSeenAt: new Date('2026-10-18T09:30:00.000Z'),
        current: true,
      },
      {
        id: phone,
        label: 'Safari on iPhone',
        createdAt: new Date('2026-10-02T10:00:00.000Z'),
        lastSeenAt: new Date('2026-10-17T21:15:00.000Z'),
        revokedAt: new Date('2026-10-18T09:00:00.000Z'),
        current: false,
      },
    ])
    expect(sent).toEqual([
      {
        url: '/backend/devices',
        method: 'GET',
        authorization: 'Bearer token-1',
        device: 'device-1',
        body: undefined,
      },
    ])
  })

  it('on 401 gives up with data:AUTH_FAILED without a second request: the token is dead', async () => {
    const { fetcher, sent } = fakeFetch(
      respond(401, { code: 'unauthorized' }),
      respond(200, listed),
    )
    const refused = (await api(fetcher).list())._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(refused.message).toBe('the gateway refused the session token')
    expect(sent).toHaveLength(1)
  })

  it('refuses a list that does not follow the schema, naming the status only', async () => {
    const malformed = { devices: [{ ...listed.devices[0], id: 'device-laptop' }] }
    const { fetcher } = fakeFetch(respond(200, malformed))
    const failed = (await api(fetcher).list())._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(failed.message).toMatch(/200/)
    expect(failed.message).not.toMatch(/device-laptop/)
  })

  it('signs one device out with DELETE /devices/:id (204)', async () => {
    const { fetcher, sent } = fakeFetch(noContent())

    expect((await api(fetcher).revoke(phone)).isOk()).toBe(true)
    expect(sent).toEqual([
      {
        url: `/backend/devices/${phone}`,
        method: 'DELETE',
        authorization: 'Bearer token-1',
        device: 'device-1',
        body: undefined,
      },
    ])
  })

  it('maps 404 no-such-device to data:WRITE_REJECTED with the code as message', async () => {
    const { fetcher } = fakeFetch(respond(404, { code: 'no-such-device' }))
    const refused = (await api(fetcher).revoke(phone))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:WRITE_REJECTED')
    expect(refused.message).toBe('no-such-device')
  })

  it('signs every device out with POST /auth/sign-out-everywhere (204)', async () => {
    const { fetcher, sent } = fakeFetch(noContent())

    expect((await api(fetcher).signOutEverywhere()).isOk()).toBe(true)
    expect(sent).toEqual([
      {
        url: '/backend/auth/sign-out-everywhere',
        method: 'POST',
        authorization: 'Bearer token-1',
        device: 'device-1',
        body: undefined,
      },
    ])
  })

  it('names the status of a failed sign-out, never its body, and a fetch that throws is data:OFFLINE', async () => {
    const failing = fakeFetch(respond(500, { code: 'internal', secret: 'hunter2' }))
    const failed = (await api(failing.fetcher).signOutEverywhere())._unsafeUnwrapErr()
    const unreachable = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(failed.message).toMatch(/500/)
    expect(failed.message).not.toMatch(/hunter2/)
    expect((await api(unreachable.fetcher).revoke(phone))._unsafeUnwrapErr().code).toBe(
      'data:OFFLINE',
    )
  })

  it('without a token asks nothing and fails with data:AUTH_FAILED', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, listed))

    expect((await api(fetcher, () => undefined).list())._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
    expect(sent).toEqual([])
  })
})
