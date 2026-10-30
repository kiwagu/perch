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

/** The client over `fetcher`, with the access token `token()` and the device `device-1`. */
function api(
  fetcher: ReturnType<typeof fakeFetch>['fetcher'],
  token: () => string | undefined = () => 'access-1',
) {
  return devicesApi('/backend', {
    token,
    device: () => 'device-1',
    renew: () => Promise.resolve(false),
    fetcher,
  })
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
        authorization: 'Bearer access-1',
        device: 'device-1',
        body: undefined,
      },
    ])
  })

  it('on 401 renews once through renew() and reads again with the new token', async () => {
    const { fetcher, sent } = fakeFetch(
      respond(401, { code: 'unauthorized' }),
      respond(200, listed),
    )
    let token = 'old'
    let renewals = 0
    const devices = devicesApi('/backend', {
      token: () => token,
      device: () => 'device-1',
      renew: () => {
        renewals += 1
        token = 'new'

        return Promise.resolve(true)
      },
      fetcher,
    })

    expect((await devices.list())._unsafeUnwrap()).toHaveLength(2)
    expect(renewals).toBe(1)
    expect(sent.map((request) => request.authorization)).toEqual(['Bearer old', 'Bearer new'])
    expect(sent.map((request) => request.device)).toEqual(['device-1', 'device-1'])
  })

  it('on 401 after a renew gives up with data:AUTH_FAILED', async () => {
    const { fetcher, sent } = fakeFetch(respond(401, { code: 'unauthorized' }))
    const devices = devicesApi('/backend', {
      token: () => 'access-1',
      device: () => 'device-1',
      renew: () => Promise.resolve(true),
      fetcher,
    })

    expect((await devices.list())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toHaveLength(2)
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
        authorization: 'Bearer access-1',
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
        authorization: 'Bearer access-1',
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
