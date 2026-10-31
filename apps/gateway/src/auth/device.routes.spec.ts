import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { device_sessionIdFactory, type IdentityId, idSchemas } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { AUTH_SECRET, deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'
import { AuthSessions } from './auth-sessions'
import { deviceRoutes } from './device.routes'
import { DeviceSessions } from './device-sessions'

const PASSWORD = 'pass-word-1'

const laptop = { id: 'laptop', label: 'Firefox on Linux' }

const phone = { id: 'phone', label: 'Safari on iPhone' }

/** The client address every request comes from. */
const FROM = '203.0.113.7'

/** A device as `GET /devices` lists it: neither its session token nor the browser's id goes out. */
const listedDevice = z.strictObject({
  id: z.string(),
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  current: z.boolean(),
})

const listed = z.strictObject({ devices: z.array(listedDevice) })

const unauthorized = { status: 401, body: { code: 'unauthorized' } }

const badRequest = { status: 400, body: { code: 'bad-request' } }

const noSuchDevice = { status: 404, body: { code: 'no-such-device' } }

const internal = { status: 500, body: { code: 'internal' } }

const noContent = { status: 204, body: undefined }

/** A failure of the directory, as a service would answer it. */
const outage = dataError('data:WRITE_FAILED', 'the directory cannot be reached')

/** Closes what a test opened. */
const cleanups: Array<() => Promise<void>> = []

/** Failures the routes answered 500 for; a test that expects one takes it. */
const failures: DataError[] = []

afterEach(async () => {
  vi.restoreAllMocks()

  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }

  expect(failures.splice(0)).toEqual([])
})

/** An identity signed in on a device: its id, its raw session token and the device. */
interface Caller {
  readonly identity: IdentityId
  readonly token: string
  readonly device: string
}

interface Ask {
  /** Sends the caller's token as `Authorization: Bearer <token>`, and its device. */
  readonly as?: Caller
  /** The `Authorization` header exactly as sent, instead of the caller's. */
  readonly authorization?: string
  /** The `X-Perch-Device` header instead of the caller's device; `null` leaves it out. */
  readonly device?: string | null
}

function request(method: string, path: string, ask: Ask = {}): Request {
  const headers = new Headers()
  const authorization = ask.authorization ?? (ask.as ? `Bearer ${ask.as.token}` : undefined)
  const device = ask.device === undefined ? ask.as?.device : ask.device

  if (authorization !== undefined) {
    headers.set('Authorization', authorization)
  }

  if (device !== undefined && device !== null) {
    headers.set('X-Perch-Device', device)
  }

  return new Request(`http://gateway.test${path}`, { method, headers })
}

async function answer(response: Response | undefined): Promise<{ status: number; body: unknown }> {
  if (!response) {
    return expect.unreachable('the route answered nothing')
  }

  const text = await response.text()
  const body: unknown = text === '' ? undefined : (JSON.parse(text) as unknown)

  return { status: response.status, body }
}

/** Makes the next call of `service[method]` fail with `outage`. */
function failsOnce<T extends object>(service: T, method: keyof T & string): void {
  vi.spyOn(service, method as never).mockReturnValueOnce(errAsync(outage) as never)
}

/**
 * The routes over a Better Auth instance on an embedded directory, with Ann signed up on her
 * laptop and signed in on her phone, and Bob signed up on his laptop. The sockets the routes
 * close are recorded, not closed.
 */
async function harness() {
  const { auth, local, clock, close } = await openAuth()

  cleanups.push(close)

  const sessions = new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET })
  const devices = new DeviceSessions({ directory: local, clock })
  /** Each close the routes asked for: the identity, the device (none for every one), the code. */
  const closed: Array<readonly [IdentityId, string | undefined, number]> = []
  const connections = {
    close: async (identity: IdentityId, device: string | undefined, code: number) => {
      closed.push([identity, device, code])
    },
  }
  const routes = deviceRoutes(sessions, devices, connections, {
    onFailure: (error) => failures.push(error),
    clock,
  })
  const identityOf = (id: string) => idSchemas.identity.schema.parse(id)
  const signIn = async (email: string, device: typeof laptop): Promise<Caller> => {
    const { token, user } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      headers: deviceHeaders(device.id, device.label),
    })

    return { identity: identityOf(user.id), token, device: device.id }
  }
  const signUp = async (email: string, device: typeof laptop): Promise<Caller> => {
    const { token, user } = await signUpOn(auth, email, deviceHeaders(device.id, device.label))

    return { identity: identityOf(user.id), token, device: device.id }
  }
  const annOnLaptop = await signUp('ann@example.test', laptop)
  const annOnPhone = await signIn('ann@example.test', phone)
  const bob = await signUp('bob@example.test', laptop)

  /** Sends the request to the routes and reads their answer. */
  const ask = async (method: string, path: string, options: Ask = {}) =>
    answer(await routes(request(method, path, options), FROM))

  /** Ann's devices as `caller` lists them. */
  const annsDevices = async (caller: Caller = annOnLaptop) => {
    const { status, body } = await ask('GET', '/devices', { as: caller })

    expect(status).toBe(200)

    return listed.parse(body).devices
  }

  /** Ann's phone as her laptop lists it. */
  const annsPhone = async () =>
    (await annsDevices()).find((device) => device.label === phone.label) ??
    expect.unreachable('the phone listed')

  /** Whether `token` still reads a live session. */
  const live = async (token: string) => (await sessions.read(token)).kind === 'session'

  return {
    routes,
    clock,
    sessions,
    devices,
    closed,
    signIn,
    ask,
    annsDevices,
    annsPhone,
    live,
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

    expect(devices.map(({ label, revokedAt, current }) => ({ label, revokedAt, current }))).toEqual(
      [
        { label: laptop.label, revokedAt: null, current: true },
        { label: phone.label, revokedAt: null, current: false },
      ],
    )
    expect(devices.every((device) => device_sessionIdFactory.is(device.id))).toBe(true)
    // A session token learns neither another device's token nor the ids the devices name.
    expect(JSON.stringify(fromLaptop.body)).not.toContain(annOnPhone.token)
    expect(JSON.stringify(fromLaptop.body)).not.toContain(`"${phone.id}"`)
    expect(listed.parse(fromPhone.body).devices.map((device) => device.current)).toEqual([
      false,
      true,
    ])
  })

  it('signs one device out: its session ended, its sockets closed with 4001, listed with when it ended', async () => {
    const { ask, clock, closed, live, annsDevices, annsPhone, annOnLaptop, annOnPhone, bob } =
      await harness()
    const [laptopRow, phoneRow] = await annsDevices()
    const laptopId = laptopRow?.id ?? expect.unreachable('the laptop listed')
    const phoneId = phoneRow?.id ?? expect.unreachable('the phone listed')

    await clock.advance(60_000)

    const endedAt = new Date(clock.now()).toISOString()

    expect(await ask('DELETE', `/devices/${phoneId}`, { as: annOnLaptop })).toEqual(noContent)
    expect(closed).toEqual([[annOnLaptop.identity, phone.id, CLOSE.revoked]])
    expect(await live(annOnPhone.token)).toBe(false)
    expect(await live(annOnLaptop.token)).toBe(true)
    expect(await live(bob.token)).toBe(true)
    // Its Bearer calls are refused at once.
    expect(await ask('GET', '/devices', { as: annOnPhone })).toEqual(unauthorized)
    expect(
      (await annsDevices()).map(({ id, label, revokedAt }) => ({ id, label, revokedAt })),
    ).toEqual([
      { id: laptopId, label: laptop.label, revokedAt: null },
      { id: phoneId, label: phone.label, revokedAt: endedAt },
    ])

    // Asked again, the device is signed out already: 204, its end kept, no socket closed again.
    await clock.advance(60_000)
    expect(await ask('DELETE', `/devices/${phoneId}`, { as: annOnLaptop })).toEqual(noContent)
    expect((await annsPhone()).revokedAt).toBe(endedAt)
    expect(closed).toHaveLength(1)
  })

  it('serves the new session of a device signed in again after its sign-out, and not the old one', async () => {
    const { ask, closed, live, signIn, annsPhone, annOnLaptop, annOnPhone } = await harness()
    const oldRow = (await annsPhone()).id

    expect(await ask('DELETE', `/devices/${oldRow}`, { as: annOnLaptop })).toEqual(noContent)

    const phoneAgain = await signIn('ann@example.test', phone)

    expect(await ask('GET', '/devices', { as: annOnPhone })).toEqual(unauthorized)
    expect((await ask('GET', '/devices', { as: phoneAgain })).status).toBe(200)
    expect((await annsPhone()).revokedAt).toBeNull()

    // The old row asked again ends nothing: the phone's new session and its sockets are left alone.
    expect(await ask('DELETE', `/devices/${oldRow}`, { as: annOnLaptop })).toEqual(noContent)
    expect(closed).toEqual([[annOnLaptop.identity, phone.id, CLOSE.revoked]])
    expect(await live(phoneAgain.token)).toBe(true)
  })

  it("answers 404 to a device that is not the caller's or does not exist, and leaves it alone", async () => {
    const { ask, devices, closed, live, annOnLaptop, bob } = await harness()
    const [bobsLaptop] = (await devices.list(bob.identity))._unsafeUnwrap()
    const id = bobsLaptop?.id ?? expect.unreachable("Bob's laptop listed")

    for (const each of [id, device_sessionIdFactory.create(), 'not-an-id']) {
      expect(await ask('DELETE', `/devices/${each}`, { as: annOnLaptop })).toEqual(noSuchDevice)
    }

    expect(await live(bob.token)).toBe(true)
    expect(closed).toEqual([])
  })

  it('signs every device of the caller out, its own included', async () => {
    const { ask, clock, closed, live, signIn, annsDevices, annOnLaptop, annOnPhone, bob } =
      await harness()

    await clock.advance(60_000)

    const endedAt = new Date(clock.now()).toISOString()

    expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop })).toEqual(noContent)
    expect(closed).toEqual([[annOnLaptop.identity, undefined, CLOSE.revoked]])
    expect(await live(annOnLaptop.token)).toBe(false)
    expect(await live(annOnPhone.token)).toBe(false)
    expect(await live(bob.token)).toBe(true)
    expect(await ask('GET', '/devices', { as: annOnLaptop })).toEqual(unauthorized)

    // Signed in again on the laptop, Ann sees the phone signed out.
    const devices = await annsDevices(await signIn('ann@example.test', laptop))

    expect(devices.map(({ label, revokedAt }) => ({ label, revokedAt }))).toEqual([
      { label: laptop.label, revokedAt: null },
      { label: phone.label, revokedAt: endedAt },
    ])
  })

  it('signs the device a session token holds out, and answers a repeat 204 again', async () => {
    const { ask, clock, closed, live, annsPhone, annOnLaptop, annOnPhone } = await harness()
    const signOut = () =>
      ask('POST', '/auth/sign-out', {
        authorization: `Bearer ${annOnPhone.token}`,
        device: phone.id,
      })

    await clock.advance(60_000)

    const endedAt = new Date(clock.now()).toISOString()

    expect(await signOut()).toEqual(noContent)
    expect(closed).toEqual([[annOnPhone.identity, phone.id, CLOSE.revoked]])
    expect(await live(annOnPhone.token)).toBe(false)
    expect(await live(annOnLaptop.token)).toBe(true)
    expect((await annsPhone()).revokedAt).toBe(endedAt)

    // Nothing is left to end: 204, no socket closed again, the end kept.
    await clock.advance(60_000)
    expect(await signOut()).toEqual(noContent)
    expect(closed).toHaveLength(1)
    expect((await annsPhone()).revokedAt).toBe(endedAt)
  })

  it('answers 401 to a sign-out whose token holds a session of another device than the one it names', async () => {
    const { ask, closed, live, annOnPhone } = await harness()

    for (const device of [laptop.id, 'device-unlisted']) {
      expect(
        await ask('POST', '/auth/sign-out', {
          authorization: `Bearer ${annOnPhone.token}`,
          device,
        }),
      ).toEqual(unauthorized)
    }

    expect(await live(annOnPhone.token)).toBe(true)
    expect(closed).toEqual([])
  })

  it('answers 401 to a sign-out whose token no session holds, and 400 to one that names no device', async () => {
    const { ask, closed, live, annOnPhone } = await harness()

    for (const authorization of [
      undefined,
      'Bearer made-up-token',
      // The signed form of a token is not the one its row holds.
      `Bearer ${annOnPhone.token}.signature`,
    ]) {
      expect(
        await ask('POST', '/auth/sign-out', {
          device: phone.id,
          ...(authorization === undefined ? {} : { authorization }),
        }),
      ).toEqual(unauthorized)
    }

    for (const device of [null, '', 'd'.repeat(65)]) {
      expect(
        await ask('POST', '/auth/sign-out', {
          authorization: `Bearer ${annOnPhone.token}`,
          device,
        }),
      ).toEqual(badRequest)
    }

    expect(await live(annOnPhone.token)).toBe(true)
    expect(closed).toEqual([])
  })

  it('answers 401 with the Bearer scheme to a call without a token that holds a live session', async () => {
    const { routes, ask, annOnLaptop } = await harness()
    const refused = await routes(request('GET', '/devices', { device: laptop.id }), FROM)

    expect(refused?.status).toBe(401)
    expect(refused?.headers.get('WWW-Authenticate')).toBe('Bearer')

    for (const authorization of ['Bearer made-up-token', 'Basic YW5uOnBhc3M=', 'Bearer']) {
      expect(await ask('GET', '/devices', { authorization, device: laptop.id })).toEqual(
        unauthorized,
      )
    }

    expect((await ask('GET', '/devices', { as: annOnLaptop })).status).toBe(200)
  })

  it('answers 401 to a call whose token holds a session of another device than the one it names', async () => {
    const { ask, closed, annOnLaptop, annOnPhone } = await harness()

    expect(await ask('GET', '/devices', { as: annOnLaptop, device: phone.id })).toEqual(
      unauthorized,
    )
    expect(
      await ask('POST', '/auth/sign-out-everywhere', { as: annOnPhone, device: 'device-unlisted' }),
    ).toEqual(unauthorized)
    expect(closed).toEqual([])
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

  it('answers 500 to a failure of the gateway, hands it to onFailure, and closes nothing', async () => {
    const { ask, sessions, devices, closed, live, annsPhone, annOnLaptop, annOnPhone } =
      await harness()
    const phoneRow = await annsPhone()

    failsOnce(sessions, 'revoke')
    expect(await ask('DELETE', `/devices/${phoneRow.id}`, { as: annOnLaptop })).toEqual(internal)
    failsOnce(sessions, 'revokeAll')
    expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop })).toEqual(internal)
    failsOnce(devices, 'list')
    expect(await ask('GET', '/devices', { as: annOnLaptop })).toEqual(internal)
    failsOnce(devices, 'byToken')
    expect(await ask('POST', '/auth/sign-out', { as: annOnPhone })).toEqual(internal)
    failsOnce(sessions, 'signOut')
    expect(await ask('POST', '/auth/sign-out', { as: annOnPhone })).toEqual(internal)

    expect(failures.splice(0)).toEqual([outage, outage, outage, outage, outage])
    expect(closed).toEqual([])
    // Nothing was ended: a device whose sign-out failed keeps its token and asks again.
    expect(await live(annOnPhone.token)).toBe(true)
    expect(await live(annOnLaptop.token)).toBe(true)
    expect(await ask('POST', '/auth/sign-out', { as: annOnPhone })).toEqual(noContent)
    expect(await live(annOnPhone.token)).toBe(false)
  })

  it('answers 500, never 401, to a Bearer call whose session could not be read', async () => {
    const { ask, sessions, annOnLaptop } = await harness()
    const unread = dataError('data:QUERY_FAILED', 'the session could not be read')

    vi.spyOn(sessions, 'read').mockResolvedValueOnce({ kind: 'failed', error: unread })

    expect(await ask('GET', '/devices', { as: annOnLaptop })).toEqual(internal)
    expect(failures.splice(0)).toEqual([unread])
  })

  it('answers 405 to a method a path does not take, and leaves other paths to the caller', async () => {
    const { routes, annOnLaptop } = await harness()

    for (const [method, path, allow] of [
      ['POST', '/devices', 'GET'],
      ['DELETE', '/devices', 'GET'],
      ['GET', '/devices/dvs_x', 'DELETE'],
      ['GET', '/auth/sign-out', 'POST'],
      ['DELETE', '/auth/sign-out-everywhere', 'POST'],
    ] as const) {
      const response = await routes(request(method, path, { as: annOnLaptop }), FROM)

      expect(await answer(response)).toEqual({ status: 405, body: { code: 'method-not-allowed' } })
      expect(response?.headers.get('Allow')).toBe(allow)
    }

    for (const path of [
      '/devices/',
      '/devices/dvs_x/more',
      '/auth/sign-in/email',
      '/auth/get-session',
      '/auth/sign-out/',
      '/organisations',
    ]) {
      expect(await routes(request('POST', path, { as: annOnLaptop }), FROM)).toBeUndefined()
    }
  })
})
