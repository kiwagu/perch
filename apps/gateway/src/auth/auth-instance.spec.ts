import type { BetterAuthPlugin } from 'better-auth'
import { signJWT } from 'better-auth/crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fromDriverValue, type LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { device_sessionIdFactory, identityIdFactory } from '@workspace/ids'

import { linkToken } from '../mail/__fixtures__/outbox'

import accountCredentialsStatement from './__fixtures__/account-credentials.surql'
import accountRefuseStatement from './__fixtures__/account-refuse.surql'
import {
  AUTH_SECRET,
  AUTH_URL,
  betterAuthToken,
  CLOCK_START,
  deviceHeaders,
  type OpenAuthOptions,
  openAuth,
  signUpOn,
} from './__fixtures__/auth-instance'
import deviceSessionDevicesStatement from './__fixtures__/device-session-devices.surql'
import deviceSessionEndsStatement from './__fixtures__/device-session-ends.surql'
import deviceSessionExpiriesStatement from './__fixtures__/device-session-expiries.surql'
import deviceSessionMoveEndStatement from './__fixtures__/device-session-move-end.surql'
import deviceSessionRowStatement from './__fixtures__/device-session-row.surql'
import identityEmailsStatement from './__fixtures__/identity-emails.surql'
import identityRoleSetStatement from './__fixtures__/identity-role-set.surql'
import identityStandingStatement from './__fixtures__/identity-standing.surql'
import identityVerifiedStatement from './__fixtures__/identity-verified.surql'
import { ADMIN_PATHS } from './admin-paths'
import { type AuthInstance, VERIFICATION_LINK_LIFETIME_S } from './auth-instance'
import { sessionHooks } from './session-hooks'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function instance(options: OpenAuthOptions = {}) {
  const opened = await openAuth(options)

  closers.push(opened.close)

  return opened
}

/** The path of every endpoint of the admin plugin `auth` runs with, read from the plugin itself. */
function adminPathsOf(auth: AuthInstance): string[] {
  const plugins: readonly BetterAuthPlugin[] = auth.options.plugins
  const endpoints = plugins.find((plugin) => plugin.id === 'admin')?.endpoints ?? {}

  return Object.values(endpoints).map((endpoint) => endpoint.path)
}

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}` })

const MINUTE_MS = 60_000

const DAY_MS = 24 * 60 * MINUTE_MS

/** When each session row ends or ended, by its token. */
async function expiries(local: LocalDb): Promise<Map<string, unknown>> {
  const [rows] = await local.db.query<[{ token: string; expires_at: unknown }[]]>(
    deviceSessionExpiriesStatement,
  )

  return new Map(rows.map((row) => [row.token, fromDriverValue(row.expires_at)]))
}

/** An update of the session rows, as the session hooks end a device's other sessions with. */
const SESSIONS_UPDATE = /\bUPDATE\s+`?device_session`?\s/

/** The insertion of a session row, as Better Auth's adapter creates a session with. */
const SESSION_INSERT = /\bINSERT\s+INTO\s+`?device_session`?\s/

/**
 * Holds the next queries matching `pattern` the instance sends, once `hold` names how many, in
 * the order they arrive; `held` lets each go on.
 */
function queriesGate(pattern: RegExp) {
  let holding = 0
  const held: Array<() => void> = []

  return {
    held,
    hold: (count: number) => {
      holding = count
    },
    before: (text: string): Promise<void> | undefined => {
      if (holding === 0 || !pattern.test(text)) {
        return undefined
      }

      holding -= 1

      return new Promise((resolve) => {
        held.push(resolve)
      })
    },
  }
}

/** Which of the tokens hold a live session, in their order. */
async function liveOf(auth: Awaited<ReturnType<typeof instance>>['auth'], tokens: string[]) {
  const reads = await Promise.all(
    tokens.map((token) => auth.api.getSession({ headers: bearer(token) })),
  )

  return reads.map((read) => read !== null)
}

describe('createAuthInstance', () => {
  it('signs up into identity and account rows with our ids and an argon2id hash', async () => {
    const { auth, local } = await instance()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    expect(user.id).toMatch(/^idn_/)
    expect(token.length).toBeGreaterThan(20)

    const [accounts] = await local.db.query<
      [{ provider_id: string; password: string; identity: string }[]]
    >(accountCredentialsStatement)

    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.provider_id).toBe('credential')
    expect(accounts[0]?.password).toMatch(/^\$argon2id\$/)
    // The adapter writes a reference as a plain string: the column holds the identity's key.
    expect(accounts[0]?.identity).toBe(user.id)
  })

  it("holds a new password to the length of the password rules, 10 to 35 characters, as Better Auth's own limits", async () => {
    const { auth, outbox } = await instance()
    const signUp = (email: string, password: string) =>
      auth.api.signUpEmail({
        body: { name: 'Ann', email, password },
        headers: deviceHeaders('laptop'),
      })

    await expect(signUp('short@example.test', 'Abcdefg1!')).rejects.toMatchObject({
      status: 'BAD_REQUEST',
      body: { code: 'PASSWORD_TOO_SHORT' },
    })
    await expect(signUp('long@example.test', `Ab1!${'c'.repeat(32)}`)).rejects.toMatchObject({
      status: 'BAD_REQUEST',
      body: { code: 'PASSWORD_TOO_LONG' },
    })
    await signUp('shortest@example.test', 'Abcdefgh1!')
    await signUp('longest@example.test', `Ab1!${'c'.repeat(31)}`)
    await outbox.next('shortest@example.test')
    await outbox.next('longest@example.test')
    expect(outbox.to('short@example.test')).toEqual([])
    expect(outbox.to('long@example.test')).toEqual([])
  })

  it('binds the device and its label to the session row at sign-up', async () => {
    const { auth, local } = await instance()

    await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop', 'Firefox on Linux'))

    const [rows] = await local.db.query<[{ device: string; label: string }[]]>(
      deviceSessionDevicesStatement,
    )

    expect(rows.map((row) => [row.device, row.label])).toEqual([['laptop', 'Firefox on Linux']])
  })

  it('refuses a sign-in that names no device', async () => {
    const { auth } = await instance()

    await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await expect(
      auth.api.signInEmail({
        body: { email: 'ann@example.test', password: 'Pass-word-1' },
        headers: new Headers({ origin: 'http://localhost' }),
      }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' })
  })

  it('ends the earlier live session of a device when it signs in again', async () => {
    const { auth, local, clock } = await instance()
    const first = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)

    const endedAt = new Date(clock.now())
    const again = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })

    expect(again.token).not.toBe(first.token)
    expect(await auth.api.getSession({ headers: bearer(first.token) })).toBeNull()

    const ends = await expiries(local)

    expect(ends.size).toBe(2) // preserved, not deleted
    expect(ends.get(first.token)).toEqual(endedAt)
  })

  it('keeps the newest session of a device live when two sign-ins created theirs before either ended the older ones', async () => {
    const gate = queriesGate(SESSIONS_UPDATE)
    const { auth } = await instance({ directory: (local) => interceptQueries(local, gate.before) })
    const first = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const signIn = () =>
      auth.api.signInEmail({
        body: { email: 'ann@example.test', password: 'Pass-word-1' },
        headers: deviceHeaders('laptop'),
      })

    gate.hold(2)

    // Each sign-in's row exists before its hook ends the device's older sessions, which waits.
    const older = signIn()

    await vi.waitFor(() => expect(gate.held).toHaveLength(1))

    const newer = signIn()

    await vi.waitFor(() => expect(gate.held).toHaveLength(2))

    // The newer sign-in's hook runs first, the older one's last.
    gate.held[1]?.()

    const newest = await newer

    gate.held[0]?.()

    const previous = await older

    expect(await liveOf(auth, [first.token, previous.token, newest.token])).toEqual([
      false,
      false,
      true,
    ])
  })

  it('ends the older session of a device whose row is inserted only after the newer sign-in ended the others', async () => {
    const gate = queriesGate(SESSION_INSERT)
    const { auth } = await instance({ directory: (local) => interceptQueries(local, gate.before) })
    const first = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const signIn = () =>
      auth.api.signInEmail({
        body: { email: 'ann@example.test', password: 'Pass-word-1' },
        headers: deviceHeaders('laptop'),
      })

    gate.hold(1)

    // The older sign-in took its creation time; its row waits to be inserted.
    const older = signIn()

    await vi.waitFor(() => expect(gate.held).toHaveLength(1))

    // The newer sign-in inserts its row and its hook runs to the end while the older row is absent.
    const newest = await signIn()

    gate.held[0]?.()

    const previous = await older

    expect(await liveOf(auth, [first.token, previous.token, newest.token])).toEqual([
      false,
      false,
      true,
    ])
  })

  it('ends a row of the lower id inserted after the hook of a row of the same instant and a greater id ran', async () => {
    const { local, clock } = await instance()
    const identity = identityIdFactory.create()
    const one = device_sessionIdFactory.create()
    const other = device_sessionIdFactory.create()
    const [lower, greater] = one < other ? [one, other] : [other, one]
    const createdAt = new Date(CLOCK_START)
    const hooks = sessionHooks(clock, local)

    // Each row is inserted and its hook runs; the row of the lower id comes last.
    for (const key of [greater, lower]) {
      await local.db.query(deviceSessionRowStatement, {
        identity,
        device: 'laptop',
        key,
        session_token: `token-${key}`,
        created_at: createdAt,
      })
      await hooks.create.after({
        id: key,
        userId: identity,
        token: `token-${key}`,
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(Date.now() + DAY_MS),
        device: 'laptop',
      })
    }

    const ends = await expiries(local)

    expect(
      [lower, greater].filter((key) => Number(ends.get(`token-${key}`)) > clock.now()),
    ).toEqual([greater])
  })

  it('keeps the row of the greater id live when two rows of a device were created at the same instant', async () => {
    const { local, clock } = await instance()
    const identity = identityIdFactory.create()
    const one = device_sessionIdFactory.create()
    const other = device_sessionIdFactory.create()
    const [lower, greater] = one < other ? [one, other] : [other, one]
    const createdAt = new Date(CLOCK_START)

    for (const key of [lower, greater]) {
      await local.db.query(deviceSessionRowStatement, {
        identity,
        device: 'laptop',
        key,
        session_token: `token-${key}`,
        created_at: createdAt,
      })
    }

    const hooks = sessionHooks(clock, local)

    // The hook of the greater row runs first, as if both rows existed before either hook ran.
    for (const key of [greater, lower]) {
      await hooks.create.after({
        id: key,
        userId: identity,
        token: `token-${key}`,
        createdAt,
        updatedAt: createdAt,
        expiresAt: new Date(Date.now() + DAY_MS),
        device: 'laptop',
      })
    }

    const ends = await expiries(local)

    expect(
      [lower, greater].filter((key) => Number(ends.get(`token-${key}`)) > clock.now()),
    ).toEqual([greater])
  })

  it("ends only the identity's older sessions on the device signing in, not another device's or another identity's", async () => {
    const { auth } = await instance()
    const laptop = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const phone = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('phone'),
    })
    // Another identity on a device of the same id.
    const bobs = await signUpOn(auth, 'bob@example.test', deviceHeaders('laptop'))
    const again = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })

    expect(await liveOf(auth, [laptop.token, phone.token, bobs.token, again.token])).toEqual([
      false,
      true,
      true,
      true,
    ])
  })

  it('reads a live session by its bearer token, with the device', async () => {
    const { auth } = await instance()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const read = await auth.api.getSession({ headers: bearer(token) })

    expect(read?.user.id).toBe(user.id)
    expect((read?.session as { device?: string } | undefined)?.device).toBe('laptop')
  })

  it('keeps the row of a signed-out session with its end as expires_at', async () => {
    const { auth, local, clock } = await instance()
    const { token } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)
    await auth.api.signOut({ headers: bearer(token) })

    expect(await expiries(local)).toEqual(new Map([[token, new Date(clock.now())]]))
    expect(await auth.api.getSession({ headers: bearer(token) })).toBeNull()
  })

  it('keeps a row ended by its own update, and its end, when its session is read again', async () => {
    const { auth, local, clock } = await instance()
    const { token } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)

    const endedAt = new Date(clock.now())

    await local.db.query(deviceSessionMoveEndStatement, { session_token: token, ends_at: endedAt })
    await clock.advance(MINUTE_MS)

    // Better Auth deletes the row of an expired session it reads; the session hooks refuse that
    // and leave an ended row's end as it was.
    expect(await auth.api.getSession({ headers: bearer(token) })).toBeNull()
    expect(await auth.api.getSession({ headers: bearer(token) })).toBeNull()
    expect(await expiries(local)).toEqual(new Map([[token, endedAt]]))
  })

  it('never moves the end of a session when it is read: Better Auth refreshes none', async () => {
    const { auth, local } = await instance()
    const { token } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    // A day left of thirty: Better Auth's daily refresh would extend it at the next read. It
    // judges by the system clock.
    const endsAt = new Date(Date.now() + DAY_MS)

    await local.db.query(deviceSessionMoveEndStatement, { session_token: token, ends_at: endsAt })

    expect(await auth.api.getSession({ headers: bearer(token) })).not.toBeNull()
    expect(await auth.api.getSession({ headers: bearer(token) })).not.toBeNull()
    expect(await expiries(local)).toEqual(new Map([[token, endsAt]]))
  })

  it('ends every live session of an identity with one update by identity', async () => {
    const { auth, local, clock } = await instance()
    const laptop = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await clock.advance(MINUTE_MS)

    const firstEnd = new Date(clock.now())
    const laptopAgain = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })
    const phone = await auth.api.signInEmail({
      body: { email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('phone'),
    })

    await clock.advance(MINUTE_MS)

    const allEnd = new Date(clock.now())

    await local.db.query(deviceSessionEndsStatement, { identity: laptop.user.id, ended_at: allEnd })

    expect(await auth.api.getSession({ headers: bearer(laptopAgain.token) })).toBeNull()
    expect(await auth.api.getSession({ headers: bearer(phone.token) })).toBeNull()
    expect(await expiries(local)).toEqual(
      new Map([
        [laptop.token, firstEnd],
        [laptopAgain.token, allEnd],
        [phone.token, allEnd],
      ]),
    )
  })

  it('serves its routes under the public URL of the auth routes only', async () => {
    const { auth } = await instance()
    const { token } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const read = (url: string) => auth.handler(new Request(url, { headers: bearer(token) }))

    expect((await read(`${AUTH_URL}/get-session`)).status, 'served under /backend/auth').toBe(200)
    expect(
      (await read('http://localhost/auth/get-session')).status,
      'the path the gateway receives is not served until the mount rewrites it',
    ).toBe(404)
  })

  it("answers Better Auth's bulk session endings 404 at its handler and ends nothing", async () => {
    const { auth } = await instance()
    const { token } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))
    const ask = (path: string, body: object = {}) =>
      auth.handler(
        new Request(`${AUTH_URL}${path}`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            origin: 'http://localhost',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      )
    const read = await auth.handler(
      new Request(`${AUTH_URL}/get-session`, { headers: bearer(token) }),
    )

    expect(read.status, 'a path that is not disabled is served at the same base').toBe(200)
    expect((await ask('/revoke-sessions')).status, 'a disabled path answers 404').toBe(404)
    expect((await ask('/revoke-other-sessions')).status, 'a disabled path answers 404').toBe(404)
    expect(
      (
        await ask('/change-password', {
          currentPassword: 'Pass-word-1',
          newPassword: 'Pass-word-2',
          revokeOtherSessions: true,
        })
      ).status,
      'a disabled path answers 404',
    ).toBe(404)
    expect(await auth.api.getSession({ headers: bearer(token) })).not.toBeNull()
  })

  it("switches off every endpoint of Better Auth's admin plugin, as the plugin's own table names them", async () => {
    const { auth } = await instance()
    const paths = adminPathsOf(auth)

    expect(paths, 'the plugin is installed and names its endpoints').not.toEqual([])
    expect(auth.options.disabledPaths).toEqual(expect.arrayContaining(paths))
    expect(ADMIN_PATHS, "the list the gateway reads is the configured plugin's").toEqual(paths)
  })

  it("answers every endpoint of the admin plugin 404 at its handler, an operator's request too, and changes nothing", async () => {
    const { auth, local } = await instance()
    const { token, user } = await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    await local.db.query(identityRoleSetStatement, {
      identity: user.id,
      role: 'operator',
      reason: 'MARKER kept',
    })

    const ask = (method: string, url: string) =>
      auth.handler(
        new Request(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            origin: 'http://localhost',
            'content-type': 'application/json',
          },
          ...(method === 'POST'
            ? { body: JSON.stringify({ userId: user.id, role: 'user', banReason: 'changed' }) }
            : {}),
        }),
      )
    const served: string[] = []

    for (const path of adminPathsOf(auth)) {
      // The path as the table names it, with a trailing slash, and with a query.
      for (const asked of [path, `${path}/`, `${path}?userId=${user.id}`]) {
        for (const method of ['GET', 'POST']) {
          const { status } = await ask(method, `${AUTH_URL}${asked}`)

          if (status !== 404) {
            served.push(`${method} ${asked} ${status}`)
          }
        }
      }
    }

    expect(served).toEqual([])

    const [standing] = await local.db.query<[unknown]>(identityStandingStatement, {
      identity: user.id,
    })

    expect(standing).toEqual({ role: 'operator', banned: false, ban_reason: 'MARKER kept' })
    expect(await auth.api.getSession({ headers: bearer(token) })).not.toBeNull()
  })

  it('a verification that names no device creates no session', async () => {
    const { auth, outbox, local } = await instance()

    await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })

    const token = betterAuthToken(linkToken(await outbox.next('ann@example.test')))

    await expect(
      auth.api.verifyEmail({
        query: { token },
        headers: new Headers({ origin: 'http://localhost' }),
      }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' })

    const [devices] = await local.db.query<[unknown[]]>(deviceSessionDevicesStatement)
    const [identities] =
      await local.db.query<[{ email: string; email_verified: boolean }[]]>(
        identityVerifiedStatement,
      )

    expect(devices).toEqual([])
    // Better Auth marks the email verified before it creates the session: that is why the mount
    // names the device before it asks.
    expect(identities).toEqual([{ email: 'ann@example.test', email_verified: true }])
  })

  it('answers a taken email, in any case, as a new one, and sends it no mail', async () => {
    const { auth, outbox, local } = await instance()

    await signUpOn(auth, 'ann@example.test', deviceHeaders('laptop'))

    const taken = await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'Ann@Example.test', password: 'Pass-word-2' },
      headers: deviceHeaders('phone'),
    })
    const fresh = await auth.api.signUpEmail({
      body: { name: 'Bob', email: 'bob@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('desk'),
    })

    // A new email's mail has gone out by now, through the same mailer a taken one's would.
    await outbox.next('bob@example.test')

    const [identities] = await local.db.query<[{ email: string }[]]>(identityEmailsStatement)

    expect([taken.token, fresh.token]).toEqual([null, null])
    expect(taken.user.email).toBe('ann@example.test')
    expect(outbox.to('ann@example.test')).toHaveLength(1)
    expect(identities.map(({ email }) => email).sort()).toEqual([
      'ann@example.test',
      'bob@example.test',
    ])
  })

  it('signs eight devices up at once, each into its own identity and session', async () => {
    const { auth } = await instance()
    const people = Array.from({ length: 8 }, (_, index) => ({
      email: `user-${index}@example.test`,
      device: `device-${index}`,
    }))
    // Every sign-up runs in a transaction of its own; none may read or write through another's.
    const signedUp = await Promise.all(
      people.map(({ email, device }) => signUpOn(auth, email, deviceHeaders(device))),
    )

    for (const { token, user } of signedUp) {
      expect(user.id).toMatch(/^idn_/)
      expect(token.length).toBeGreaterThan(20)
    }

    expect(signedUp.map(({ user }) => user.email)).toEqual(people.map(({ email }) => email))
    expect(new Set(signedUp.map(({ user }) => user.id)).size).toBe(people.length)

    const again = await auth.api.signInEmail({
      body: { email: 'user-3@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('device-3-again'),
    })

    expect(again.user.id).toBe(signedUp[3]?.user.id)

    const tokens = [...signedUp.map(({ token }) => token), again.token]
    const read = await Promise.all(
      tokens.map((token) => auth.api.getSession({ headers: bearer(token) })),
    )

    expect(read.map((session) => session?.user.id)).toEqual([
      ...signedUp.map(({ user }) => user.id),
      again.user.id,
    ])
  })

  it('leaves no identity behind sign-ups refused inside their transactions, beside ones that pass', async () => {
    const { auth, local } = await instance()

    // The directory refuses the credential row of a `refused-` email, which the sign-up writes in
    // its transaction after the identity.
    await local.db.query(accountRefuseStatement)

    const refused = (email: string) =>
      auth.api.signUpEmail({
        body: { name: 'Ann', email, password: 'Pass-word-1' },
        headers: deviceHeaders('desk'),
      })
    const settled = await Promise.allSettled([
      refused('refused-0@example.test'),
      signUpOn(auth, 'ann@example.test', deviceHeaders('laptop')),
      refused('refused-1@example.test'),
      signUpOn(auth, 'bob@example.test', deviceHeaders('phone')),
    ])

    expect(settled.map(({ status }) => status)).toEqual([
      'rejected',
      'fulfilled',
      'rejected',
      'fulfilled',
    ])

    // The next sign-up on the same instance runs on the connection again, not on a finished
    // transaction.
    const later = await signUpOn(auth, 'zoe@example.test', deviceHeaders('tablet'))

    expect(later.user.id).toMatch(/^idn_/)
    expect((await auth.api.getSession({ headers: bearer(later.token) }))?.user.id).toBe(
      later.user.id,
    )

    const [identities] = await local.db.query<[{ email: string }[]]>(identityEmailsStatement)

    expect(identities.map(({ email }) => email).sort()).toEqual([
      'ann@example.test',
      'bob@example.test',
      'zoe@example.test',
    ])
  })
})

describe('createAuthInstance, the verification of an email', () => {
  // A sign-up signs nothing in and mails the account its link; the account stays unverified until
  // a test opens it.
  it('signs nothing in at sign-up and sends one mail, in the language signed up in', async () => {
    const { auth, outbox, local } = await instance()
    const answer = await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1', locale: 'es' },
      headers: deviceHeaders('laptop'),
    })
    const [devices] = await local.db.query<[unknown[]]>(deviceSessionDevicesStatement)

    expect(answer.token).toBeNull()
    expect((await outbox.next('ann@example.test')).subject).toBe('Confirma tu correo para Perch')
    expect(devices).toEqual([])
  })

  it('refuses the sign-in of an unverified account with its right password, and sends nothing', async () => {
    const { auth, outbox } = await instance()

    await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })
    await outbox.next('ann@example.test')

    await expect(
      auth.api.signInEmail({
        body: { email: 'ann@example.test', password: 'Pass-word-1' },
        headers: deviceHeaders('laptop'),
      }),
    ).rejects.toMatchObject({ status: 'FORBIDDEN', body: { code: 'EMAIL_NOT_VERIFIED' } })
    expect(outbox.to('ann@example.test')).toHaveLength(1)
  })

  it('sends the verification mail again for an unverified account, in its language, and alike answers for any email', async () => {
    const { auth, outbox } = await instance()

    await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1', locale: 'es' },
      headers: deviceHeaders('laptop'),
    })
    await outbox.next('ann@example.test')

    for (const email of ['ann@example.test', 'nobody@example.test']) {
      expect(
        await auth.api.sendVerificationEmail({ body: { email }, headers: deviceHeaders('laptop') }),
      ).toEqual({ status: true })
    }

    // The sign-up's mail first, the resend's second.
    const mail = await outbox.next('ann@example.test', 1)

    expect(mail.subject).toBe('Confirma tu correo para Perch')
    expect(mail.text).toContain('http://localhost/verify-email?token=')
    expect(outbox.to('nobody@example.test')).toHaveLength(0)
  })

  it('keeps the language of the sign-up, English when it named none, and refuses one it does not speak', async () => {
    const { auth, outbox } = await instance()

    await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })

    expect((await outbox.next('ann@example.test')).subject).toBe('Confirm your email for Perch')
    await expect(
      auth.api.signUpEmail({
        body: { name: 'Bob', email: 'bob@example.test', password: 'Pass-word-1', locale: 'fr' },
        headers: deviceHeaders('desk'),
      }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' })
  })

  it('signs the device of the first verification in; the link opened again signs nothing in', async () => {
    const { auth, outbox, local } = await instance()

    await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })

    const token = betterAuthToken(linkToken(await outbox.next('ann@example.test')))
    const first = await auth.api.verifyEmail({
      query: { token },
      headers: deviceHeaders('phone', 'Phone'),
      returnHeaders: true,
    })
    const again = await auth.api.verifyEmail({
      query: { token },
      headers: deviceHeaders('phone', 'Phone'),
      returnHeaders: true,
    })
    const [devices] = await local.db.query<[{ device: string; label: string }[]]>(
      deviceSessionDevicesStatement,
    )

    expect(first.headers.get('set-auth-token')).not.toBeNull()
    expect(again.headers.get('set-auth-token')).toBeNull()
    // The sign-up on the laptop signed nothing in: the one session is the phone's.
    expect(devices.map(({ device }) => device)).toEqual(['phone'])
  })

  it('refuses a link past its lifetime with TOKEN_EXPIRED', async () => {
    const { auth } = await instance()
    const expired = await signJWT({ email: 'ann@example.test' }, AUTH_SECRET, -10)

    await expect(
      auth.api.verifyEmail({ query: { token: expired }, headers: deviceHeaders('phone') }),
    ).rejects.toMatchObject({ status: 'UNAUTHORIZED', body: { code: 'TOKEN_EXPIRED' } })
  })

  it('signs a link that lives a day', async () => {
    const { auth, outbox } = await instance()

    await auth.api.signUpEmail({
      body: { name: 'Ann', email: 'ann@example.test', password: 'Pass-word-1' },
      headers: deviceHeaders('laptop'),
    })

    const [, payload] = betterAuthToken(linkToken(await outbox.next('ann@example.test'))).split('.')
    const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as {
      iat: number
      exp: number
    }

    expect(claims.exp - claims.iat).toBe(VERIFICATION_LINK_LIFETIME_S)
    expect(VERIFICATION_LINK_LIFETIME_S).toBe(86_400)
  })
})
