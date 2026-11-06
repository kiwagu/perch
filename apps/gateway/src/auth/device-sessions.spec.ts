import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import {
  device_sessionIdFactory,
  type IdentityId,
  identityIdFactory,
  idSchemas,
} from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { manualClock } from '@workspace/replica/testing'

import {
  AUTH_SECRET,
  CLOCK_START,
  deviceHeaders,
  openAuth,
  signUpOn,
} from './__fixtures__/auth-instance'
import deviceSessionExpiriesStatement from './__fixtures__/device-session-expiries.surql'
import deviceSessionMoveEndStatement from './__fixtures__/device-session-move-end.surql'
import deviceSessionRowStatement from './__fixtures__/device-session-row.surql'
import { type AuthInstance, SESSION_LIFETIME_MS } from './auth-instance'
import { AuthSessions } from './auth-sessions'
import { deviceRoutes } from './device.routes'
import { type DeviceSessionRow, endedAt } from './device-session-rows'
import { DeviceSessions } from './device-sessions'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const MINUTE_MS = 60_000

const DAY_MS = 24 * 60 * MINUTE_MS

/** A Better Auth instance and the device rows of its directory, on its clock. */
async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  return {
    ...opened,
    devices: new DeviceSessions({ directory: opened.local, clock: opened.clock }),
  }
}

/** The identity id the sign-up answered with, as the gateway types it. */
const identityOf = (id: string): IdentityId => idSchemas.identity.schema.parse(id)

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` })

/** What ending a session takes: the instance, the gateway's endings, its identity and token. */
interface Ending {
  readonly auth: AuthInstance
  readonly sessions: AuthSessions
  readonly identity: IdentityId
  readonly token: string
}

/** Every way the session of Ann's laptop ends, each at the moment the clock reads. */
const ENDINGS: ReadonlyArray<readonly [string, (ending: Ending) => Promise<void>]> = [
  [
    'its sign-out',
    async ({ sessions, token }) => {
      ;(await sessions.signOut(token))._unsafeUnwrap()
    },
  ],
  [
    'its ending by its row',
    async ({ sessions, identity, token }) => {
      const read = await sessions.read(token)
      const id = read.kind === 'session' ? read.caller.session : expect.unreachable('a session')

      ;(await sessions.revoke(identity, id))._unsafeUnwrap()
    },
  ],
  [
    'the ending of every session of its identity',
    async ({ sessions, identity }) => {
      ;(await sessions.revokeAll(identity))._unsafeUnwrap()
    },
  ],
  [
    "Better Auth's own sign-out",
    async ({ auth, token }) => {
      await auth.api.signOut({ headers: bearer(token) })
    },
  ],
  [
    'a new sign-in of its device',
    async ({ auth }) => {
      await auth.api.signInEmail({
        body: { email: 'ann@example.test', password: 'Pass-word-1' },
        headers: deviceHeaders('laptop'),
      })
    },
  ],
]

/** What marking a session that expired takes, beside what ending a live one takes. */
interface ExpiredEnding extends Ending {
  readonly devices: DeviceSessions
  readonly clock: Clock
}

/**
 * Why each of `ENDINGS` signed the device out, as its row keeps it for the device's next hello:
 * only a sign-out from another device names a reason; the device's own sign-out and a new sign-in
 * of the same device name none.
 */
const REASONS: Readonly<Record<string, DeviceSessionRow['endedReason']>> = {
  'its sign-out': undefined,
  'its ending by its row': 'revoked',
  'the ending of every session of its identity': 'revoked',
  "Better Auth's own sign-out": undefined,
  'a new sign-in of its device': undefined,
}

/**
 * Every way a session that already expired, and was never ended, is marked ended, each at the
 * moment the clock reads.
 */
const EXPIRED_ENDINGS: ReadonlyArray<readonly [string, (ending: ExpiredEnding) => Promise<void>]> =
  [
    [
      'its sign-out over the route, which closes no socket',
      async ({ sessions, devices, clock, token }) => {
        const closed: unknown[] = []
        const routes = deviceRoutes(
          sessions,
          devices,
          {
            close: async (...close) => {
              closed.push(close)
            },
          },
          { onFailure: () => expect.unreachable('a failure'), clock },
        )
        const response = await routes(
          new Request('http://gateway.test/auth/sign-out', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'X-Perch-Device': 'laptop' },
          }),
          '203.0.113.7',
        )

        expect(response?.status).toBe(204)
        // No live session ended now: the device's sockets are not this session's.
        expect(closed).toEqual([])
      },
    ],
    [
      'a read of it, which Better Auth answers by deleting its row',
      async ({ auth, token }) => {
        expect(await auth.api.getSession({ headers: bearer(token) })).toBeNull()
      },
    ],
    [
      'its ending by its row',
      async ({ sessions, devices, identity, token }) => {
        const row = (await devices.byToken(token))._unsafeUnwrap() ?? expect.unreachable('a row')

        expect((await sessions.revoke(identity, row.id))._unsafeUnwrap().kind).toBe('already-ended')
      },
    ],
    [
      'the ending of every session of its identity',
      async ({ sessions, identity }) => {
        ;(await sessions.revokeAll(identity))._unsafeUnwrap()
      },
    ],
  ]

/** The tokens of every session row of the directory. */
async function tokens(local: LocalDb): Promise<string[]> {
  const [rows] = await local.db.query<[{ token: string }[]]>(deviceSessionExpiriesStatement)

  return rows.map((row) => row.token).sort()
}

describe('DeviceSessions', () => {
  it('lists the session rows of the devices of an identity, live ones without an end', async () => {
    const { auth, clock, devices } = await harness()
    const laptop = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop', 'Laptop'))
    const phone = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('phone', 'Phone'),
    })
    const ann = identityOf(laptop.user.id)

    await signUpOn(auth, 'bob@example.test', deviceHeaders('desk'))

    const rows = (await devices.list(ann))._unsafeUnwrap()

    expect(rows.map((row) => [row.identity, row.device, row.label, row.token])).toEqual([
      [ann, 'laptop', 'Laptop', laptop.token],
      [ann, 'phone', 'Phone', phone.token],
    ])
    expect(rows.map((row) => endedAt(row, clock.now()))).toEqual([undefined, undefined])
    expect(rows[0]?.id).toMatch(/^dvs_/)
    expect(rows[0]?.createdAt).toBeInstanceOf(Date)
    expect(rows[0]?.lastSeenAt).toBeInstanceOf(Date)
  })

  it('lists an ended session with its end, and forgets it 30 days after it ended', async () => {
    const { auth, local, clock, devices } = await harness()
    const laptop = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const phone = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('phone'),
    })
    const bob = await signUpOn(auth, 'bob@example.test', deviceHeaders('desk'))
    const ann = identityOf(laptop.user.id)
    const ended = new Date(clock.now())

    for (const token of [phone.token, bob.token]) {
      await local.db.query(deviceSessionMoveEndStatement, { session_token: token, ends_at: ended })
    }

    const listed = (await devices.list(ann))._unsafeUnwrap()

    expect(listed.map((row) => [row.device, endedAt(row, clock.now())])).toEqual([
      ['laptop', undefined],
      ['phone', ended],
    ])

    await clock.advance(30 * DAY_MS - 1)

    expect((await devices.list(ann))._unsafeUnwrap().map((row) => row.device)).toEqual([
      'laptop',
      'phone',
    ])

    await clock.advance(1)

    const later = (await devices.list(ann))._unsafeUnwrap()

    expect(later.map((row) => [row.device, endedAt(row, clock.now())])).toEqual([
      ['laptop', undefined],
    ])
    // Only the rows of the identity listed are forgotten.
    expect(await tokens(local)).toEqual([laptop.token, bob.token].sort())
  })

  it("lists a device's latest session once, in the place of the device's first", async () => {
    const { auth, devices } = await harness()
    const first = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const signIn = (device: string) =>
      auth.api.signInEmail({
        body: { email: 'ann@example.test', password: 'Pass-word-1' },
        headers: deviceHeaders(device),
      })
    const phone = await signIn('phone')
    const again = await signIn('laptop')

    const rows = (await devices.list(identityOf(first.user.id)))._unsafeUnwrap()

    expect(rows.map((row) => [row.device, row.token])).toEqual([
      ['laptop', again.token],
      ['phone', phone.token],
    ])
  })

  it('lists the row of the greater id when two rows of a device were created at once', async () => {
    const { local, devices } = await harness()
    const identity = identityIdFactory.create()
    const one = device_sessionIdFactory.create()
    const other = device_sessionIdFactory.create()
    const [lower, greater] = one < other ? [one, other] : [other, one]

    for (const key of [greater, lower]) {
      await local.db.query(deviceSessionRowStatement, {
        identity,
        device: 'tablet',
        key,
        session_token: `token-${key}`,
        created_at: new Date(CLOCK_START),
      })
    }

    expect((await devices.list(identity))._unsafeUnwrap().map((row) => row.id)).toEqual([greater])
  })

  it('finds a row by the session token it holds, and none for a token nobody holds', async () => {
    const { auth, devices } = await harness()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    expect((await devices.byToken(token))._unsafeUnwrap()).toMatchObject({
      identity: user.id,
      device: 'laptop',
      token,
    })
    expect((await devices.byToken('nonsense'))._unsafeUnwrap()).toBeUndefined()
  })

  it("marks a device's live session seen now and slides it to a full lifetime again", async () => {
    const { auth, clock, devices } = await harness()
    const first = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)

    // Signing the laptop in again ends its first session now.
    const again = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })
    const ended = (await devices.byToken(first.token))._unsafeUnwrap()

    await clock.advance(MINUTE_MS)
    ;(await devices.seen({ identity: identityOf(first.user.id), device: 'laptop' }))._unsafeUnwrap()

    const seenAt = clock.now()

    expect((await devices.byToken(again.token))._unsafeUnwrap()).toMatchObject({
      lastSeenAt: new Date(seenAt),
      expiresAt: new Date(seenAt + SESSION_LIFETIME_MS),
    })
    // The ended session stays as it was: neither seen nor extended.
    expect((await devices.byToken(first.token))._unsafeUnwrap()).toEqual(ended)
  })

  it.each(ENDINGS)(
    'leaves a session ended by %s ended when a seen write that took its instants earlier lands after it, and again',
    async (_, end) => {
      const { auth, local, clock, devices } = await harness()
      const sessions = new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET })
      const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
      const identity = identityOf(user.id)

      // Just behind the system clock, which Better Auth judges expiry by: a session extended from
      // here would read as live again.
      await clock.advance(Date.now() - 2 * MINUTE_MS - clock.now())

      // A seen write takes its instants now and lands only after the ending, a minute later.
      const late = new DeviceSessions({ directory: local, clock: manualClock(clock.now()) })

      await clock.advance(MINUTE_MS)
      await end({ auth, sessions, identity, token })

      const ended = (await devices.byToken(token))._unsafeUnwrap()

      // Sent late, then sent again with the same instants, as a retry after a conflict sends it.
      ;(await late.seen({ identity, device: 'laptop' }))._unsafeUnwrap()
      ;(await late.seen({ identity, device: 'laptop' }))._unsafeUnwrap()

      expect(await sessions.read(token)).toEqual({ kind: 'none' })
      expect((await devices.byToken(token))._unsafeUnwrap()).toEqual(ended)
      expect(ended).toMatchObject({
        expiresAt: new Date(clock.now()),
        endedAt: new Date(clock.now()),
      })
    },
  )

  it.each(EXPIRED_ENDINGS)(
    'marks a session that expired ended by %s, so a seen write that took its instants before the expiry cannot bring it back',
    async (_, end) => {
      const { auth, local, clock, devices } = await harness()
      const sessions = new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET })
      const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
      const identity = identityOf(user.id)

      // Just behind the system clock, which Better Auth judges expiry by.
      await clock.advance(Date.now() - 3 * MINUTE_MS - clock.now())

      // A seen write takes its instants now, while the session is live; it lands much later.
      const late = new DeviceSessions({ directory: local, clock: manualClock(clock.now()) })
      const expiry = new Date(clock.now() + MINUTE_MS)

      await local.db.query(deviceSessionMoveEndStatement, { session_token: token, ends_at: expiry })
      // The session expired a minute ago, and nothing ended it.
      await clock.advance(2 * MINUTE_MS)
      await end({ auth, sessions, devices, clock, identity, token })

      const ended = (await devices.byToken(token))._unsafeUnwrap()

      // Sent late, then sent again with the same instants, as a retry after a conflict sends it.
      ;(await late.seen({ identity, device: 'laptop' }))._unsafeUnwrap()
      ;(await late.seen({ identity, device: 'laptop' }))._unsafeUnwrap()

      expect(await sessions.read(token)).toEqual({ kind: 'none' })
      expect((await devices.byToken(token))._unsafeUnwrap()).toEqual(ended)
      // Marked ended at its expiry, which stays where it was.
      expect(ended).toMatchObject({ expiresAt: expiry, endedAt: expiry })
    },
  )

  it.each(ENDINGS)('keeps why %s signed the device out, for its next hello', async (name, end) => {
    const { auth, local, clock, devices } = await harness()
    const sessions = new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET })
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)
    await end({ auth, sessions, identity: identityOf(user.id), token })

    const row = (await devices.byToken(token))._unsafeUnwrap() ?? expect.unreachable('a row')

    expect(row.endedAt).toEqual(new Date(clock.now()))
    expect(row.endedReason).toBe(REASONS[name])
  })

  it.each(EXPIRED_ENDINGS)(
    'keeps no reason for a session that had expired when %s marked it ended',
    async (_, end) => {
      const { auth, local, clock, devices } = await harness()
      const sessions = new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET })
      const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
      const identity = identityOf(user.id)

      await clock.advance(Date.now() - 3 * MINUTE_MS - clock.now())

      const expiry = new Date(clock.now() + MINUTE_MS)

      await local.db.query(deviceSessionMoveEndStatement, { session_token: token, ends_at: expiry })
      await clock.advance(2 * MINUTE_MS)
      await end({ auth, sessions, devices, clock, identity, token })

      const row = (await devices.byToken(token))._unsafeUnwrap() ?? expect.unreachable('a row')

      expect(row.endedAt).toEqual(expiry)
      expect(row.endedReason).toBeUndefined()
    },
  )

  it('fails its reads and writes once the directory is closed', async () => {
    const { auth, local, devices } = await harness()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const ann = identityOf(user.id)

    await local.close()

    expect((await devices.list(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect((await devices.byToken(token))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect((await devices.seen({ identity: ann, device: 'laptop' }))._unsafeUnwrapErr().code).toBe(
      'data:WRITE_FAILED',
    )
  })
})

describe('endedAt', () => {
  const row = {
    id: device_sessionIdFactory.create(),
    identity: identityOf('idn_0000000000000000000000000'),
    device: 'laptop',
    label: '',
    token: 'token-1',
    createdAt: new Date(0),
    lastSeenAt: new Date(0),
    expiresAt: new Date(1_000),
  }

  it('is the end of a session that ended by now, and none before', () => {
    expect(endedAt(row, 999)).toBeUndefined()
    expect(endedAt(row, 1_000)).toEqual(new Date(1_000))
    expect(endedAt(row, 2_000)).toEqual(new Date(1_000))
  })
})
