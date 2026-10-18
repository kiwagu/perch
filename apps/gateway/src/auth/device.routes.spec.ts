import { afterEach, describe, expect, it } from 'vitest'

import { createAuth, type DataError, type LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { device_sessionIdFactory, type IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

import { DIRECTORY, NAMESPACE } from '../config'
import { ConnectionRegistry } from '../sync/connections'

import { deviceRoutes } from './device.routes'
import { DeviceSessions } from './device-sessions'
import { type DeviceTokens, IdentitySessions } from './identity-sessions'
import devicesOfStatement from './surql/devices-of.surql'
import grantRevokeStatement from './surql/grant-revoke.surql'
import grantsRevokeAllStatement from './surql/grants-revoke-all.surql'

const PASSWORD = 'pass-word-1'

const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

const phone = { id: 'device-phone', label: 'Safari on iPhone' }

/** A device as `GET /devices` lists it. */
const listedDevice = z.strictObject({
  id: z.string(),
  device: z.string(),
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  current: z.boolean(),
})

const listed = z.strictObject({ devices: z.array(listedDevice) })

/** Closes what a test opened. */
const cleanups: Array<() => Promise<void>> = []

/** Failures the routes answered 500 for; a test that expects one takes it. */
const failures: DataError[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }

  expect(failures.splice(0)).toEqual([])
})

/** An identity signed in on a device: its id, its pair and the device. */
interface Caller {
  readonly identity: IdentityId
  readonly tokens: DeviceTokens
  readonly device: string
}

interface Ask {
  /** Sends the caller's access token as `Authorization: Bearer <access>` and its device. */
  readonly as?: Caller
  /** The `X-Perch-Device` header instead of the caller's device; `null` leaves it out. */
  readonly device?: string | null
  /** The JSON body, or a text sent as it is. */
  readonly body?: unknown
}

function request(method: string, path: string, ask: Ask = {}): Request {
  const headers = new Headers()
  const device = ask.device === undefined ? ask.as?.device : ask.device

  if (ask.as) {
    headers.set('Authorization', `Bearer ${ask.as.tokens.access}`)
  }

  if (device !== undefined && device !== null) {
    headers.set('X-Perch-Device', device)
  }

  if (ask.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  return new Request(`http://gateway.test${path}`, {
    method,
    headers,
    ...(ask.body === undefined
      ? {}
      : { body: typeof ask.body === 'string' ? ask.body : JSON.stringify(ask.body) }),
  })
}

async function answer(response: Response | undefined): Promise<{ status: number; body: unknown }> {
  if (!response) {
    return expect.unreachable('the route answered nothing')
  }

  const text = await response.text()
  const body: unknown = text === '' ? undefined : (JSON.parse(text) as unknown)

  return { status: response.status, body }
}

/** A connection that keeps the codes it was ended with. */
function listener() {
  const ended: number[] = []

  return {
    ended,
    memberships: () => Promise.resolve(),
    revoke: () => Promise.resolve(),
    end: (code: number) => {
      ended.push(code)

      return Promise.resolve()
    },
  }
}

const unauthorized = { status: 401, body: { code: 'unauthorized' } }

const badRequest = { status: 400, body: { code: 'bad-request' } }

const noContent = { status: 204, body: undefined }

interface HarnessOptions {
  /** Answers the database's RPC `revoke`; it succeeds by default. */
  readonly rpc?: () => Promise<Response>
  /** Runs before each statement sent to the directory; it may throw to make it fail. */
  readonly directoryQueries?: (text: string) => void
}

/**
 * The routes over services on an embedded directory, with Ann signed in on her laptop and her
 * phone and Bob on his laptop, and a connection of each device registered. The database's RPC
 * over HTTP is a fake that records each call.
 */
async function harness(options: HarnessOptions = {}) {
  const local: LocalDb = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY })
  )._unsafeUnwrap()

  cleanups.push(() => local.close())

  const clock = manualClock(Date.now())
  const rpcCalls: unknown[] = []
  const rpc = async (_: string | URL | Request, init?: RequestInit): Promise<Response> => {
    rpcCalls.push(JSON.parse(String(init?.body)) as unknown)

    return options.rpc ? options.rpc() : Response.json({ id: 1, result: null })
  }
  const directory = options.directoryQueries
    ? interceptQueries(local, options.directoryQueries)
    : local
  const devices = new DeviceSessions({ directory, clock })
  const sessions = new IdentitySessions({
    openAuth: () =>
      createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
    rpcUrl: 'http://127.0.0.1:8000/rpc',
    fetch: Object.assign(rpc, { preconnect: () => {} }),
    onCloseFailure: (error) => failures.push(error),
    devices,
    clock,
  })
  const connections = new ConnectionRegistry({ onFailure: (error) => failures.push(error) })
  const routes = deviceRoutes(sessions, devices, connections, {
    onFailure: (error) => failures.push(error),
  })
  const signIn = async (
    action: 'signUp' | 'signIn',
    email: string,
    device: typeof laptop,
  ): Promise<Caller> => {
    const signed = (await sessions[action]({ email, password: PASSWORD }, device))._unsafeUnwrap()

    return { identity: signed.identity.id, tokens: signed.tokens, device: device.id }
  }
  const annOnLaptop = await signIn('signUp', 'ann@example.test', laptop)
  const annOnPhone = await signIn('signIn', 'ann@example.test', phone)
  const bob = await signIn('signUp', 'bob@example.test', laptop)
  const sockets = {
    annLaptop: listener(),
    annPhone: listener(),
    bobLaptop: listener(),
  }
  const ann = annOnLaptop.identity

  for (const [identity, device, socket] of [
    [ann, laptop.id, sockets.annLaptop],
    [ann, phone.id, sockets.annPhone],
    [bob.identity, laptop.id, sockets.bobLaptop],
  ] as const) {
    connections.add(identity, device, socket, connections.epoch(identity, device))
  }

  /** Sends the request to the routes and reads their answer. */
  const ask = async (method: string, path: string, ask: Ask = {}) =>
    answer(await routes(request(method, path, ask)))

  /** Ann's devices as her laptop lists them. */
  const annsDevices = async () => {
    const { status, body } = await ask('GET', '/devices', { as: annOnLaptop })

    expect(status).toBe(200)

    return listed.parse(body).devices
  }

  /** Ann's phone as her laptop lists it. */
  const annsPhone = async () =>
    (await annsDevices()).find((device) => device.device === phone.id) ??
    expect.unreachable('the phone listed')

  /** A sign-out request of a pair: the pair in the body, the device in its header. */
  const signOut = (pair: DeviceTokens, device: string | null = phone.id) =>
    ask('POST', '/auth/sign-out', { device, body: { access: pair.access, refresh: pair.refresh } })

  return {
    routes,
    sessions,
    devices,
    rpcCalls,
    ask,
    annsDevices,
    annsPhone,
    signOut,
    sockets,
    annOnLaptop,
    annOnPhone,
    bob,
  }
}

describe('deviceRoutes', () => {
  it("lists the caller's devices, the earliest first, with the one it asks from as current", async () => {
    const { ask, annOnLaptop, annOnPhone } = await harness()

    const fromLaptop = await ask('GET', '/devices', { as: annOnLaptop })
    const fromPhone = await ask('GET', '/devices', { as: annOnPhone })

    expect(fromLaptop.status).toBe(200)

    const devices = listed.parse(fromLaptop.body).devices

    expect(
      devices.map(({ device, label, revokedAt, current }) => ({
        device,
        label,
        revokedAt,
        current,
      })),
    ).toEqual([
      { device: laptop.id, label: laptop.label, revokedAt: null, current: true },
      { device: phone.id, label: phone.label, revokedAt: null, current: false },
    ])
    expect(devices.every((device) => device_sessionIdFactory.is(device.id))).toBe(true)
    expect(listed.parse(fromPhone.body).devices.map((device) => device.current)).toEqual([
      false,
      true,
    ])
  })

  it('answers 401 to a request without an access token that works', async () => {
    const { routes, annOnLaptop } = await harness()

    for (const path of ['/devices', '/devices/dvs_x']) {
      const method = path === '/devices' ? 'GET' : 'DELETE'

      expect(await answer(await routes(request(method, path, { device: laptop.id })))).toEqual(
        unauthorized,
      )
    }

    const forged = { ...annOnLaptop, tokens: { ...annOnLaptop.tokens, access: 'not-a-token' } }

    expect(await answer(await routes(request('GET', '/devices', { as: forged })))).toEqual(
      unauthorized,
    )
  })

  it('answers 400 to a Bearer call that names no device or a device of another form', async () => {
    const { ask, annOnLaptop } = await harness()

    for (const device of [null, '', 'd'.repeat(65)]) {
      expect(await ask('GET', '/devices', { as: annOnLaptop, device })).toEqual(badRequest)
      expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop, device })).toEqual(
        badRequest,
      )
    }
  })

  it('answers 401 to a Bearer call of a device with no session row', async () => {
    const { ask, annOnLaptop, sockets } = await harness()

    expect(await ask('GET', '/devices', { as: annOnLaptop, device: 'device-unlisted' })).toEqual(
      unauthorized,
    )
    expect(
      await ask('POST', '/auth/sign-out-everywhere', {
        as: annOnLaptop,
        device: 'device-unlisted',
      }),
    ).toEqual(unauthorized)
    expect(sockets.annLaptop.ended).toEqual([])
  })

  it('signs one device out: its row revoked, its grant revoked and its sockets closed with 4001; its Bearer calls refused at once', async () => {
    const { ask, annsDevices, annsPhone, sessions, sockets, annOnLaptop, annOnPhone } =
      await harness()
    const phoneRow = await annsPhone()
    const stale = { access: 'stale', refresh: annOnPhone.tokens.refresh }

    sessions.park({
      identity: annOnPhone.identity,
      device: phone.id,
      spentRefresh: 'surreal-refresh-spent-key',
      tokens: annOnPhone.tokens,
    })

    expect(await ask('DELETE', `/devices/${phoneRow.id}`, { as: annOnLaptop })).toEqual(noContent)
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(sockets.annLaptop.ended).toEqual([])
    expect(sockets.bobLaptop.ended).toEqual([])
    expect((await sessions.authenticate(stale)).isErr()).toBe(true)
    // A pair parked for the device is gone with it.
    expect(
      sessions.parked({ device: phone.id, refresh: 'surreal-refresh-spent-key' }),
    ).toBeUndefined()
    // Its access token still signs Ann in, but not on this device any more.
    expect(await ask('GET', '/devices', { as: annOnPhone })).toEqual(unauthorized)

    const after = await annsDevices()

    expect(after.map((device) => device.device)).toEqual([laptop.id, phone.id])
    expect(after[1]?.revokedAt).toMatch(/^\d{4}-/)
    expect(after[0]?.revokedAt).toBeNull()
  })

  it("answers 404 for a device that is not the caller's or does not exist, and leaves it alone", async () => {
    const { ask, devices, annOnLaptop, bob, sockets } = await harness()
    const [bobsLaptop] = (await devices.list(bob.identity))._unsafeUnwrap()
    const id = bobsLaptop?.id ?? expect.unreachable("Bob's laptop listed")

    for (const each of [id, device_sessionIdFactory.create(), 'not-an-id']) {
      expect(await ask('DELETE', `/devices/${each}`, { as: annOnLaptop })).toEqual({
        status: 404,
        body: { code: 'no-such-device' },
      })
    }

    const [after] = (await devices.list(bob.identity))._unsafeUnwrap()

    expect(after?.revokedAt).toBeUndefined()
    expect(after?.grant).toBe(bobsLaptop?.grant)
    expect(sockets.bobLaptop.ended).toEqual([])
  })

  it("closes the device's sockets and forgets its parked pair when its grant fails to be revoked, then answers 500", async () => {
    let failing = false
    const { ask, annsPhone, sessions, sockets, annOnLaptop, annOnPhone } = await harness({
      directoryQueries: (text) => {
        if (failing && text === grantRevokeStatement) {
          throw new Error('the directory went away')
        }
      },
    })
    const phoneRow = await annsPhone()

    sessions.park({
      identity: annOnPhone.identity,
      device: phone.id,
      spentRefresh: 'surreal-refresh-spent-key',
      tokens: annOnPhone.tokens,
    })
    failing = true

    expect(await ask('DELETE', `/devices/${phoneRow.id}`, { as: annOnLaptop })).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(
      sessions.parked({ device: phone.id, refresh: 'surreal-refresh-spent-key' }),
    ).toBeUndefined()
  })

  it('signs every device of the caller out, its own included', async () => {
    const { ask, sessions, sockets, annOnLaptop, annOnPhone, bob } = await harness()

    expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop })).toEqual(noContent)
    expect(sockets.annLaptop.ended).toEqual([CLOSE.revoked])
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(sockets.bobLaptop.ended).toEqual([])

    // The tokens issued before are refused, and the refresh keys renew nothing.
    expect(await ask('GET', '/devices', { as: annOnPhone })).toEqual(unauthorized)

    for (const caller of [annOnLaptop, annOnPhone]) {
      const stale = { access: 'stale', refresh: caller.tokens.refresh }

      expect((await sessions.authenticate(stale)).isErr()).toBe(true)
    }

    const bobs = await ask('GET', '/devices', { as: bob })

    expect(listed.parse(bobs.body).devices.map((device) => device.revokedAt)).toEqual([null])
  })

  it('closes every socket of the caller when signing out everywhere fails after its first write, then answers 500', async () => {
    let failing = false
    const { ask, sockets, annOnLaptop } = await harness({
      directoryQueries: (text) => {
        if (failing && text === grantsRevokeAllStatement) {
          throw new Error('the directory went away')
        }
      },
    })

    failing = true

    expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop })).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(sockets.annLaptop.ended).toEqual([CLOSE.revoked])
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(sockets.bobLaptop.ended).toEqual([])
  })

  it("signs a device's pair out: its row marked, the pair revoked through the database's RPC", async () => {
    const { signOut, annsPhone, rpcCalls, sessions, annOnPhone } = await harness()

    sessions.park({
      identity: annOnPhone.identity,
      device: phone.id,
      spentRefresh: 'surreal-refresh-spent-key',
      tokens: annOnPhone.tokens,
    })

    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
    expect(rpcCalls).toEqual([
      {
        id: 1,
        method: 'revoke',
        params: [{ access: annOnPhone.tokens.access, refresh: annOnPhone.tokens.refresh }],
      },
    ])
    expect((await annsPhone()).revokedAt).toMatch(/^\d{4}-/)
    expect(
      sessions.parked({ device: phone.id, refresh: 'surreal-refresh-spent-key' }),
    ).toBeUndefined()
  })

  it('takes a sign-out whose access token no longer works: the pair is renewed, and the renewed pair is revoked', async () => {
    const { signOut, annsPhone, rpcCalls, annOnPhone } = await harness()

    expect(await signOut({ access: 'expired-access', refresh: annOnPhone.tokens.refresh })).toEqual(
      noContent,
    )
    expect(rpcCalls).toHaveLength(1)

    const [call] = z
      .array(z.object({ params: z.tuple([z.object({ access: z.string(), refresh: z.string() })]) }))
      .parse(rpcCalls)

    expect(call?.params[0].refresh).not.toBe(annOnPhone.tokens.refresh)
    expect((await annsPhone()).revokedAt).toMatch(/^\d{4}-/)
  })

  it("answers 401 to a sign-out whose pair is not one of the identity's device pairs, without asking the database to revoke it", async () => {
    const { signOut, rpcCalls, annOnPhone, bob } = await harness()

    expect(
      await signOut({ access: annOnPhone.tokens.access, refresh: bob.tokens.refresh }),
    ).toEqual(unauthorized)
    expect(rpcCalls).toEqual([])
  })

  it('answers 401 to a sign-out of a dead pair, without asking the database to revoke it', async () => {
    const { signOut, ask, rpcCalls, annOnLaptop, annOnPhone } = await harness()

    expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop })).toEqual(noContent)
    expect(await signOut(annOnPhone.tokens)).toEqual(unauthorized)
    expect(rpcCalls).toEqual([])
  })

  it('answers 401 to a sign-out whose pair the database refuses to revoke', async () => {
    const { signOut, annOnPhone } = await harness({
      rpc: () =>
        Promise.resolve(
          Response.json({ id: 1, error: { code: -32002, message: 'There was a problem' } }),
        ),
    })

    expect(await signOut(annOnPhone.tokens)).toEqual(unauthorized)
  })

  it('answers 500 to a sign-out the database could not judge: the pair may be revoked later', async () => {
    const { signOut, annOnPhone } = await harness({
      rpc: () => Promise.reject(new TypeError('the database is unreachable')),
    })

    expect(await signOut(annOnPhone.tokens)).toEqual({ status: 500, body: { code: 'internal' } })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })

  it('answers 400 to a sign-out without its device or without its pair', async () => {
    const { ask, signOut, rpcCalls, annOnPhone } = await harness()

    expect(await signOut(annOnPhone.tokens, null)).toEqual(badRequest)

    for (const body of [
      {},
      { refresh: annOnPhone.tokens.refresh },
      { access: annOnPhone.tokens.access, refresh: '' },
      '{"refresh":',
    ]) {
      expect(await ask('POST', '/auth/sign-out', { device: phone.id, body })).toEqual(badRequest)
    }

    expect(rpcCalls).toEqual([])
  })

  it('answers 500 to a failure of the gateway and hands it to onFailure', async () => {
    let failing = false
    const { ask, annOnLaptop } = await harness({
      directoryQueries: (text) => {
        if (failing && text === devicesOfStatement) {
          throw new Error('the directory is gone')
        }
      },
    })

    failing = true

    expect(await ask('GET', '/devices', { as: annOnLaptop })).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:QUERY_FAILED'])
  })

  it('answers 405 to a method a path does not take, and leaves other paths to the caller', async () => {
    const { routes } = await harness()

    for (const [method, path, allow] of [
      ['POST', '/devices', 'GET'],
      ['GET', '/devices/dvs_x', 'DELETE'],
      ['GET', '/auth/sign-out-everywhere', 'POST'],
      ['GET', '/auth/sign-out', 'POST'],
    ] as const) {
      const response = await routes(request(method, path))

      expect(response?.status).toBe(405)
      expect(response?.headers.get('allow')).toBe(allow)
    }

    for (const path of ['/auth/sign-in', '/devices/a/b', '/organisations', '/health']) {
      expect(await routes(request('GET', path))).toBeUndefined()
    }
  })
})
