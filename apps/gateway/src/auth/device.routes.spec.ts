import { afterEach, describe, expect, it } from 'vitest'

import { createAuth, type DataError, fromDriverValue, type LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { device_sessionIdFactory, type IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

import { DIRECTORY, NAMESPACE } from '../config'
import type { Allowance } from '../limits/fixed-window'
import { ConnectionRegistry } from '../sync/connections'

import liveGrantsStatement from './__fixtures__/grants-live.surql'
import { deviceRoutes } from './device.routes'
import { DeviceSessions } from './device-sessions'
import {
  type DeviceTokens,
  grantIdOf,
  IdentitySessions,
  type RenewalGate,
} from './identity-sessions'
import deviceSignedOutStatement from './surql/device-signed-out.surql'
import devicesOfStatement from './surql/devices-of.surql'
import grantRevokeStatement from './surql/grant-revoke.surql'
import grantsRevokeAllStatement from './surql/grants-revoke-all.surql'

/** The access method identities sign in through, and the scope its tokens are issued for. */
const identityAccess = { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }

const PASSWORD = 'pass-word-1'

const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

const phone = { id: 'device-phone', label: 'Safari on iPhone' }

/** The client address every request comes from. */
const FROM = '203.0.113.7'

/** A gate that lets every renewal through. */
const anyRenewal: RenewalGate = () => true

/** A device as `GET /devices` lists it: neither its grant nor the browser's id goes out. */
const listedDevice = z.strictObject({
  id: z.string(),
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  current: z.boolean(),
})

const listed = z.strictObject({ devices: z.array(listedDevice) })

/** Waits for the next whole second, in which a sign-in starts a session later than any token so far. */
function nextSecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1_010 - (Date.now() % 1_000)))
}

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
    supersede: () => {},
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
  /** Runs before each statement sent to the directory; it may throw to make it fail. */
  readonly directoryQueries?: (text: string) => void
  /** Answers each renewal the routes count, by client address and device; all allowed by default. */
  readonly renewal?: (from: string, device: string) => Allowance
}

/**
 * The routes over services on an embedded directory, with Ann signed in on her laptop and her
 * phone and Bob on his laptop, and a connection of each device registered. `outage` makes every
 * auth session opened from then on fail to open, as a database that cannot be reached would; what
 * it answers ends the outage.
 */
async function harness(options: HarnessOptions = {}) {
  const local: LocalDb = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY })
  )._unsafeUnwrap()

  cleanups.push(() => local.close())

  const clock = manualClock(Date.now())
  const directory = options.directoryQueries
    ? interceptQueries(local, options.directoryQueries)
    : local
  const devices = new DeviceSessions({ directory, clock })
  const sessions = new IdentitySessions({
    openAuth: () => createAuth(local, identityAccess),
    scope: identityAccess,
    onFailure: (error) => failures.push(error),
    devices,
    clock,
  })
  const newSession = local.db.newSession.bind(local.db)
  const outage = (): (() => void) => {
    local.db.newSession = () => Promise.reject(new Error('the database cannot be reached'))

    return () => {
      local.db.newSession = newSession
    }
  }
  const connections = new ConnectionRegistry({ onFailure: (error) => failures.push(error) })
  /** How many times the routes checked keys: each opens an auth session on the database. */
  let authentications = 0
  /** The renewals the routes counted, by client address and device. */
  const renewalsAsked: Array<readonly [string, string]> = []
  const routes = deviceRoutes(
    {
      authenticate: (
        tokens: { readonly access: string; readonly refresh?: string },
        renewal?: RenewalGate,
      ) => {
        authentications += 1

        return tokens.refresh === undefined
          ? sessions.authenticate({ access: tokens.access })
          : sessions.authenticate(
              { access: tokens.access, refresh: tokens.refresh },
              renewal ?? expect.unreachable('a refresh key without a gate'),
            )
      },
      unpark: (identity, device) => sessions.unpark(identity, device),
    },
    devices,
    connections,
    {
      onFailure: (error) => failures.push(error),
      limits: {
        renewal: (from, device) => {
          renewalsAsked.push([from, device])

          return options.renewal ? options.renewal(from, device) : { allowed: true }
        },
      },
    },
  )
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
    answer(await routes(request(method, path, ask), FROM))

  /** Ann's devices as her laptop lists them. */
  const annsDevices = async () => {
    const { status, body } = await ask('GET', '/devices', { as: annOnLaptop })

    expect(status).toBe(200)

    return listed.parse(body).devices
  }

  /** Ann's phone as her laptop lists it. */
  const annsPhone = async () =>
    (await annsDevices()).find((device) => device.label === phone.label) ??
    expect.unreachable('the phone listed')

  /** A sign-out request of a pair: the pair in the body, the device in its header. */
  const signOut = (pair: DeviceTokens, device: string | null = phone.id) =>
    ask('POST', '/auth/sign-out', { device, body: { access: pair.access, refresh: pair.refresh } })

  /** Whether `refresh` still renews a pair; a renewal spends it. */
  const renews = async (refresh: string) =>
    (await sessions.authenticate({ access: 'stale', refresh }, anyRenewal)).isOk()

  /** The ids of the refresh grants of `identity` that are not revoked. */
  const liveGrants = async (identity: IdentityId) => {
    const [grants] = await local.db.query<[unknown]>(liveGrantsStatement, { identity })

    return z
      .array(z.object({ id: z.string() }))
      .parse(fromDriverValue(grants))
      .map((grant) => grant.id)
      .sort()
  }

  return {
    routes,
    sessions,
    devices,
    outage,
    renews,
    liveGrants,
    authentications: () => authentications,
    renewalsAsked,
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

    expect(devices.map(({ label, revokedAt, current }) => ({ label, revokedAt, current }))).toEqual(
      [
        { label: laptop.label, revokedAt: null, current: true },
        { label: phone.label, revokedAt: null, current: false },
      ],
    )
    expect(devices.every((device) => device_sessionIdFactory.is(device.id))).toBe(true)
    // A live access token learns no browser's id: a hello binds by it.
    expect(JSON.stringify(fromLaptop.body)).not.toContain(laptop.id)
    expect(JSON.stringify(fromLaptop.body)).not.toContain(phone.id)
    expect(listed.parse(fromPhone.body).devices.map((device) => device.current)).toEqual([
      false,
      true,
    ])
  })

  it('answers 401 to a request without an access token that works', async () => {
    const { routes, annOnLaptop } = await harness()

    for (const path of ['/devices', '/devices/dvs_x']) {
      const method = path === '/devices' ? 'GET' : 'DELETE'

      expect(
        await answer(await routes(request(method, path, { device: laptop.id }), FROM)),
      ).toEqual(unauthorized)
    }

    const forged = { ...annOnLaptop, tokens: { ...annOnLaptop.tokens, access: 'not-a-token' } }

    expect(await answer(await routes(request('GET', '/devices', { as: forged }), FROM))).toEqual(
      unauthorized,
    )
  })

  it('answers 400 to a Bearer call that names no device or a device of another form, before any check of keys', async () => {
    const { ask, authentications, annOnLaptop } = await harness()
    const forged = { ...annOnLaptop, tokens: { ...annOnLaptop.tokens, access: 'not-a-token' } }

    for (const device of [null, '', 'd'.repeat(65)]) {
      expect(await ask('GET', '/devices', { as: annOnLaptop, device })).toEqual(badRequest)
      expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop, device })).toEqual(
        badRequest,
      )
      expect(await ask('GET', '/devices', { as: forged, device })).toEqual(badRequest)
    }

    expect(authentications()).toBe(0)
  })

  it('names the Bearer scheme in WWW-Authenticate when it answers 401 to a call without a working access token', async () => {
    const { routes } = await harness()
    const refused = await routes(request('GET', '/devices', { device: laptop.id }), FROM)

    expect(refused?.status).toBe(401)
    expect(refused?.headers.get('WWW-Authenticate')).toBe('Bearer')
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
    expect((await sessions.authenticate(stale, anyRenewal)).isErr()).toBe(true)
    // A pair parked for the device is gone with it.
    expect(
      sessions.parked({ device: phone.id, refresh: 'surreal-refresh-spent-key' }),
    ).toBeUndefined()
    // Its access token still signs Ann in, but not on this device any more.
    expect(await ask('GET', '/devices', { as: annOnPhone })).toEqual(unauthorized)

    const after = await annsDevices()

    expect(after.map((device) => device.label)).toEqual([laptop.label, phone.label])
    expect(after[1]?.revokedAt).toMatch(/^\d{4}-/)
    expect(after[0]?.revokedAt).toBeNull()
  })

  it('refuses the Bearer calls of an access token issued before its device signed in again, and takes the new pair', async () => {
    const { ask, sessions, annsPhone, annOnLaptop, annOnPhone } = await harness()
    const phoneRow = await annsPhone()

    expect(await ask('DELETE', `/devices/${phoneRow.id}`, { as: annOnLaptop })).toEqual(noContent)

    // Signed in again on the phone in a later second: its row is live again, with a new session.
    await nextSecond()

    const again = (
      await sessions.signIn({ email: 'ann@example.test', password: PASSWORD }, phone)
    )._unsafeUnwrap()
    const phoneAgain = { identity: again.identity.id, tokens: again.tokens, device: phone.id }

    // The old access token still signs Ann in, but it belongs to the session the sign-out ended.
    expect(await ask('GET', '/devices', { as: annOnPhone })).toEqual(unauthorized)
    expect((await ask('GET', '/devices', { as: phoneAgain })).status).toBe(200)
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

      expect((await sessions.authenticate(stale, anyRenewal)).isErr()).toBe(true)
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

  it("signs a device's pair out: its row marked, its grant revoked through the database, its sockets closed", async () => {
    const { signOut, annsPhone, renews, sessions, sockets, annOnPhone } = await harness()

    sessions.park({
      identity: annOnPhone.identity,
      device: phone.id,
      spentRefresh: 'surreal-refresh-spent-key',
      tokens: annOnPhone.tokens,
    })

    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
    expect((await annsPhone()).revokedAt).toMatch(/^\d{4}-/)
    expect(await renews(annOnPhone.tokens.refresh)).toBe(false)
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(sockets.annLaptop.ended).toEqual([])
    expect(
      sessions.parked({ device: phone.id, refresh: 'surreal-refresh-spent-key' }),
    ).toBeUndefined()
  })

  it('takes a sign-out whose access token no longer works: the pair is renewed, and the renewed grant is revoked', async () => {
    const { signOut, annsPhone, liveGrants, annOnLaptop, annOnPhone } = await harness()

    expect(await signOut({ access: 'expired-access', refresh: annOnPhone.tokens.refresh })).toEqual(
      noContent,
    )
    expect((await annsPhone()).revokedAt).toMatch(/^\d{4}-/)
    // Only the laptop's grant lives: the phone's was spent, the one it was renewed to revoked.
    expect(await liveGrants(annOnPhone.identity)).toEqual([grantIdOf(annOnLaptop.tokens.refresh)])
  })

  it('takes a retry of a sign-out that failed after marking the row: the grant is revoked then', async () => {
    let failOnce = false
    const { signOut, renews, annOnPhone } = await harness({
      directoryQueries: (text) => {
        if (failOnce && text === grantRevokeStatement) {
          failOnce = false
          throw new Error('the directory went away')
        }
      },
    })

    failOnce = true

    expect(await signOut(annOnPhone.tokens)).toEqual({ status: 500, body: { code: 'internal' } })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
    expect(await renews(annOnPhone.tokens.refresh)).toBe(false)
  })

  it('signs out a pair whose row is marked already, and revokes its grant', async () => {
    const { signOut, devices, renews, annOnPhone } = await harness()

    ;(
      await devices.signedOut({
        identity: annOnPhone.identity,
        grant: grantIdOf(annOnPhone.tokens.refresh) ?? expect.unreachable('a grant'),
      })
    )._unsafeUnwrap()

    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
    expect(await renews(annOnPhone.tokens.refresh)).toBe(false)
  })

  it('signs out a pair whose device was signed out from another one: its grant revoked already, 204', async () => {
    const { ask, signOut, annsPhone, renews, sockets, annOnLaptop, annOnPhone } = await harness()
    const phoneRow = await annsPhone()

    expect(await ask('DELETE', `/devices/${phoneRow.id}`, { as: annOnLaptop })).toEqual(noContent)
    expect(await renews(annOnPhone.tokens.refresh)).toBe(false)

    // Its access token still works; the row stays marked and the revoked grant revokes again.
    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
    expect((await annsPhone()).revokedAt).toMatch(/^\d{4}-/)
    expect(sockets.annLaptop.ended).toEqual([])
  })

  it('finishes a sign-out that renewed its pair when its row fails to be marked once: the mark is tried again, 204', async () => {
    let failOnce = false
    const { signOut, annsPhone, liveGrants, sockets, annOnLaptop, annOnPhone } = await harness({
      directoryQueries: (text) => {
        if (failOnce && text === deviceSignedOutStatement) {
          failOnce = false
          throw new Error('the directory went away')
        }
      },
    })

    failOnce = true

    expect(await signOut({ access: 'expired-access', refresh: annOnPhone.tokens.refresh })).toEqual(
      noContent,
    )
    expect((await annsPhone()).revokedAt).toMatch(/^\d{4}-/)
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(await liveGrants(annOnPhone.identity)).toEqual([grantIdOf(annOnLaptop.tokens.refresh)])
  })

  it("closes the device's sockets and leaves no live grant when a sign-out that renewed its pair cannot mark the row, then answers 500", async () => {
    let failing = false
    const { signOut, sessions, liveGrants, sockets, annOnLaptop, annOnPhone } = await harness({
      directoryQueries: (text) => {
        if (failing && text === deviceSignedOutStatement) {
          throw new Error('the directory went away')
        }
      },
    })

    sessions.park({
      identity: annOnPhone.identity,
      device: phone.id,
      spentRefresh: 'surreal-refresh-spent-key',
      tokens: annOnPhone.tokens,
    })
    failing = true

    // The refresh key is spent by the renewal: asked again, the pair would be refused, so the
    // route closes what it can before it answers.
    expect(await signOut({ access: 'expired-access', refresh: annOnPhone.tokens.refresh })).toEqual(
      { status: 500, body: { code: 'internal' } },
    )
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
    expect(sockets.annPhone.ended).toEqual([CLOSE.revoked])
    expect(sockets.annLaptop.ended).toEqual([])
    expect(
      sessions.parked({ device: phone.id, refresh: 'surreal-refresh-spent-key' }),
    ).toBeUndefined()
    expect(await liveGrants(annOnPhone.identity)).toEqual([grantIdOf(annOnLaptop.tokens.refresh)])
  })

  it('answers 429 with Retry-After to a pair sign-out whose renewal the limit refuses, and revokes nothing', async () => {
    const { routes, annsPhone, renews, sockets, renewalsAsked, annOnPhone } = await harness({
      renewal: () => ({ allowed: false, retryAfterMs: 90_500 }),
    })
    const stale = { access: 'expired-access', refresh: annOnPhone.tokens.refresh }
    const response = await routes(
      request('POST', '/auth/sign-out', { device: phone.id, body: stale }),
      FROM,
    )

    expect(response?.headers.get('Retry-After')).toBe('91')
    expect(await answer(response)).toEqual({ status: 429, body: { code: 'rate-limited' } })
    expect(renewalsAsked).toEqual([[FROM, phone.id]])
    // The row stays as it was, and the refresh key was not spent.
    expect((await annsPhone()).revokedAt).toBeNull()
    expect(sockets.annPhone.ended).toEqual([])
    expect(await renews(annOnPhone.tokens.refresh)).toBe(true)
  })

  it('counts no renewal for a pair sign-out whose access token works', async () => {
    const { signOut, renewalsAsked, annOnPhone } = await harness({
      renewal: () => expect.unreachable('the limit was asked'),
    })

    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
    expect(renewalsAsked).toEqual([])
  })

  it("answers 401 to a sign-out whose pair is not one of the identity's device pairs, and revokes nothing", async () => {
    const { signOut, renews, sockets, annOnPhone, bob } = await harness()

    expect(
      await signOut({ access: annOnPhone.tokens.access, refresh: bob.tokens.refresh }),
    ).toEqual(unauthorized)
    expect(sockets.annPhone.ended).toEqual([])
    expect(await renews(bob.tokens.refresh)).toBe(true)
  })

  it('answers 401 to a sign-out of a dead pair', async () => {
    const { signOut, ask, annOnLaptop, annOnPhone } = await harness()

    expect(await ask('POST', '/auth/sign-out-everywhere', { as: annOnLaptop })).toEqual(noContent)
    // Dead: its access token no longer works and its grant is revoked. (A token issued in the
    // second of the sign-out everywhere would still work until it expires.)
    expect(await signOut({ ...annOnPhone.tokens, access: 'expired' })).toEqual(unauthorized)
  })

  it('answers 400 to a sign-out without its device or without its pair, before any check of keys', async () => {
    const { ask, signOut, authentications, annOnPhone } = await harness()

    expect(await signOut(annOnPhone.tokens, null)).toEqual(badRequest)

    for (const body of [
      {},
      { refresh: annOnPhone.tokens.refresh },
      { access: annOnPhone.tokens.access, refresh: '' },
      '{"refresh":',
    ]) {
      expect(await ask('POST', '/auth/sign-out', { device: phone.id, body })).toEqual(badRequest)
    }

    expect(authentications()).toBe(0)
  })

  it('answers 500, never 401, to a sign-out whose pair the database could not judge, and signs nothing out', async () => {
    const { signOut, annsPhone, outage, sockets, annOnPhone } = await harness()
    const end = outage()

    expect(await signOut(annOnPhone.tokens)).toEqual({ status: 500, body: { code: 'internal' } })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:QUERY_FAILED'])

    end()

    expect((await annsPhone()).revokedAt).toBeNull()
    expect(sockets.annPhone.ended).toEqual([])
    // The pair was not refused: asked again once the database answers, it is signed out.
    expect(await signOut(annOnPhone.tokens)).toEqual(noContent)
  })

  it('answers 500, never 401, to a Bearer call whose access token the database could not judge', async () => {
    const { ask, outage, annOnLaptop } = await harness()
    const end = outage()

    expect(await ask('GET', '/devices', { as: annOnLaptop })).toEqual({
      status: 500,
      body: { code: 'internal' },
    })
    expect(failures.splice(0).map((failure) => failure.code)).toEqual(['data:QUERY_FAILED'])

    end()

    expect((await ask('GET', '/devices', { as: annOnLaptop })).status).toBe(200)
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
      const response = await routes(request(method, path), FROM)

      expect(response?.status).toBe(405)
      expect(response?.headers.get('allow')).toBe(allow)
    }

    for (const path of ['/auth/sign-in', '/devices/a/b', '/organisations', '/health']) {
      expect(await routes(request('GET', path), FROM)).toBeUndefined()
    }
  })
})
