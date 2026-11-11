import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DataError, LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

import { sessionStates } from '../auth/__fixtures__/account-ban'
import identityRoleSetStatement from '../auth/__fixtures__/identity-role-set.surql'
import {
  ANN,
  ARGON2_WAIT,
  type Close,
  heldQueries,
  isAdmission,
  mountedOnRealAuth,
  PASSWORD,
  postTo,
  signedInOn,
  signInRequest,
  welcomed,
} from '../auth/auth-handler/__fixtures__/mount'

import { MADE_AT, writeAccount, writeSession } from './__fixtures__/accounts'
import { banOf, sessionEndingsOf } from './__fixtures__/ban-rows'
import identityUpdateRefuseStatement from './__fixtures__/identity-update-refuse.surql'
import sessionUpdateRefuseStatement from './__fixtures__/session-update-refuse.surql'
import { AccountBans } from './account-bans'
import { AccountDirectory } from './account-directory'
import { consoleRoutes } from './console-routes'

const HOUR_MS = 60 * 60 * 1000

/** The moment the bans of these specs are written at: ten days after the accounts were made. */
const NOW = new Date(MADE_AT.getTime() + 240 * HOUR_MS)

/** The instant `hours` hours before `NOW`. */
const before = (hours: number): Date => new Date(NOW.getTime() - hours * HOUR_MS)

/** The instant `hours` hours after `NOW`. */
const after = (hours: number): Date => new Date(NOW.getTime() + hours * HOUR_MS)

/** Closes what a test opened. */
const opened: LocalDb[] = []

afterEach(async () => {
  for (const local of opened.splice(0)) {
    await local.close()
  }
})

/** A fresh directory, and the bans over it on a clock that stands at `NOW` until moved. */
async function bansOver() {
  const local = (await openTestDb())._unsafeUnwrap()
  const clock = manualClock(NOW.getTime())

  opened.push(local)

  return { local, clock, bans: new AccountBans({ directory: local, clock }) }
}

/** An account that signed in before, with one session in each state a ban meets, by its name. */
async function bobWithSessions(local: LocalDb) {
  const bob = await writeAccount(local, { email: 'bob@example.test', emailVerified: true })
  const devices = {
    live: await writeSession(local, bob, { lastSeenAt: before(1) }),
    waiting: await writeSession(local, bob, { lastSeenAt: before(2), pending: true }),
    expired: await writeSession(local, bob, { lastSeenAt: before(48) }),
    ended: await writeSession(local, bob, { lastSeenAt: before(72), endedAt: before(60) }),
  }

  return { bob, devices }
}

/** The endings of `identity`'s sessions by the names `devices` gives their devices. */
async function endingsByName(
  local: LocalDb,
  identity: IdentityId,
  devices: Readonly<Record<string, string>>,
) {
  const endings = await sessionEndingsOf(local, identity)

  return Object.fromEntries(
    Object.entries(devices).map(([name, device]) => [name, endings[device]]),
  )
}

describe('AccountBans.ban', () => {
  it('bans the account and ends, in the same step, every session of it not ended already, live, waiting or expired, banned', async () => {
    const { local, bans } = await bansOver()
    const { bob, devices } = await bobWithSessions(local)

    expect((await bans.ban(bob, 'spam'))._unsafeUnwrap()).toBe('banned')
    expect(await banOf(local, bob)).toEqual({ banned: true, ban_reason: 'spam' })
    expect(await endingsByName(local, bob, devices)).toEqual({
      live: { pending: false, expires_at: NOW, ended_at: NOW, ended_reason: 'banned' },
      waiting: { pending: true, expires_at: NOW, ended_at: NOW, ended_reason: 'banned' },
      // Marked ended at its expiry, as every ending marks an expired session.
      expired: {
        pending: false,
        expires_at: before(24),
        ended_at: before(24),
        ended_reason: 'banned',
      },
      ended: { pending: false, expires_at: before(60), ended_at: before(60) },
    })
  })

  it('leaves another account and its sessions as they are', async () => {
    const { local, bans } = await bansOver()
    const { bob } = await bobWithSessions(local)
    const cat = await writeAccount(local, { email: 'cat@example.test', emailVerified: true })
    const device = await writeSession(local, cat, { lastSeenAt: before(1) })

    expect((await bans.ban(bob, 'spam'))._unsafeUnwrap()).toBe('banned')

    expect(await banOf(local, cat)).toEqual({ banned: false })
    expect(await sessionEndingsOf(local, cat)).toEqual({
      [device]: { pending: false, expires_at: after(23) },
    })
  })

  it.each([
    { given: '  spam\n', kept: { ban_reason: 'spam' } },
    { given: ' \t ', kept: {} },
    { given: '', kept: {} },
    { given: undefined, kept: {} },
  ])('keeps the reason $given trimmed, and none when nothing is left', async ({ given, kept }) => {
    const { local, bans } = await bansOver()
    const bob = await writeAccount(local, { email: 'bob@example.test' })

    expect((await bans.ban(bob, given))._unsafeUnwrap()).toBe('banned')

    expect(await banOf(local, bob)).toEqual({ banned: true, ...kept })
  })

  it('leaves the ban no lapse, so it lasts until an operator lifts it', async () => {
    const { local, bans } = await bansOver()
    const bob = await writeAccount(local, { email: 'bob@example.test', banExpires: after(24) })

    expect((await bans.ban(bob, 'spam'))._unsafeUnwrap()).toBe('banned')

    expect(await banOf(local, bob)).toEqual({ banned: true, ban_reason: 'spam' })
  })

  it('keeps the ban of an account banned already, with the reason given now, and ends nothing more', async () => {
    const { local, clock, bans } = await bansOver()
    const { bob, devices } = await bobWithSessions(local)

    expect((await bans.ban(bob, 'spam'))._unsafeUnwrap()).toBe('banned')

    const ended = await endingsByName(local, bob, devices)

    await clock.advance(HOUR_MS)

    expect((await bans.ban(bob, 'abuse'))._unsafeUnwrap()).toBe('banned')
    expect(await banOf(local, bob)).toEqual({ banned: true, ban_reason: 'abuse' })
    expect(await endingsByName(local, bob, devices)).toEqual(ended)

    expect((await bans.ban(bob, undefined))._unsafeUnwrap()).toBe('banned')

    expect(await banOf(local, bob)).toEqual({ banned: true })
  })

  it('answers gone for an identity no account has, and ends none of the sessions still under it', async () => {
    const { local, bans } = await bansOver()
    const gone = identityIdFactory.create()
    const device = await writeSession(local, gone, { lastSeenAt: before(1) })

    expect((await bans.ban(gone, 'spam'))._unsafeUnwrap()).toBe('gone')
    expect(await sessionEndingsOf(local, gone)).toEqual({
      [device]: { pending: false, expires_at: after(23) },
    })
  })

  it.each([
    { refused: 'the change of the account', refusal: identityUpdateRefuseStatement },
    { refused: 'the end of its sessions', refusal: sessionUpdateRefuseStatement },
  ])(
    'changes nothing when the directory refuses $refused: neither the ban without the endings nor the endings without the ban',
    async ({ refusal }) => {
      const { local, bans } = await bansOver()
      const { bob, devices } = await bobWithSessions(local)
      const endings = await endingsByName(local, bob, devices)

      await local.db.query(refusal)

      expect((await bans.ban(bob, 'spam')).isErr()).toBe(true)
      expect(await banOf(local, bob)).toEqual({ banned: false })
      expect(await endingsByName(local, bob, devices)).toEqual(endings)
    },
  )
})

describe('AccountBans.unban', () => {
  it('lifts the ban and its reason, and brings back none of the sessions it ended', async () => {
    const { local, clock, bans } = await bansOver()
    const { bob, devices } = await bobWithSessions(local)

    expect((await bans.ban(bob, 'spam'))._unsafeUnwrap()).toBe('banned')

    const ended = await endingsByName(local, bob, devices)

    await clock.advance(HOUR_MS)

    expect((await bans.unban(bob))._unsafeUnwrap()).toBe('unbanned')
    expect(await banOf(local, bob)).toEqual({ banned: false })
    expect(await endingsByName(local, bob, devices)).toEqual(ended)
  })

  it('lifts a lapse of the ban written before', async () => {
    const { local, bans } = await bansOver()
    const bob = await writeAccount(local, {
      email: 'bob@example.test',
      banned: true,
      banReason: 'spam',
      banExpires: after(24),
    })

    expect((await bans.unban(bob))._unsafeUnwrap()).toBe('unbanned')

    expect(await banOf(local, bob)).toEqual({ banned: false })
  })

  it('leaves an account that is not banned as it is, its sessions live', async () => {
    const { local, bans } = await bansOver()
    const { bob, devices } = await bobWithSessions(local)
    const endings = await endingsByName(local, bob, devices)

    expect((await bans.unban(bob))._unsafeUnwrap()).toBe('unbanned')
    expect(await banOf(local, bob)).toEqual({ banned: false })
    expect(await endingsByName(local, bob, devices)).toEqual(endings)
  })

  it('answers gone for an identity no account has', async () => {
    const { bans } = await bansOver()

    expect((await bans.unban(identityIdFactory.create()))._unsafeUnwrap()).toBe('gone')
  })
})

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The client address every request comes from. */
const FROM = '203.0.113.7'

const MINUTE_MS = 60_000

/**
 * The console's routes over the mount's directory, its gateway sessions, its registry of sockets,
 * its clock and the accounts' turns its own routes take, as the server serves them, with an
 * operator signed in on its desk: `ban` bans an account as that operator, and `closes` keeps each
 * close the console asked for.
 */
async function consoleOver(mounted: Mounted) {
  const operator = await signedInOn(mounted, 'operator@example.test', ['desk'])
  const closes: Close[] = []
  const failures: DataError[] = []

  await mounted.local.db.query(identityRoleSetStatement, {
    identity: operator.identity,
    role: 'operator',
  })

  const routes = consoleRoutes({
    sessions: mounted.sessions,
    accounts: new AccountDirectory(mounted.local),
    bans: new AccountBans({ directory: mounted.local, clock: mounted.clock }),
    connections: {
      close: (identity, device, code) => {
        closes.push([identity, device, code])

        return mounted.registry.close(identity, device, code)
      },
    },
    turns: mounted.turns,
    onFailure: (error) => failures.push(error),
  })

  return {
    closes,
    failures,
    ban: async (identity: IdentityId) =>
      routes(
        postTo(`/console/accounts/${identity}/ban`, { reason: 'spam' }, operator.on('desk')),
        FROM,
      ),
  }
}

/** The session rows of `identity`, the earliest first: the device, whether it waits, its end. */
async function rowsOf(local: LocalDb, identity: IdentityId) {
  return (await sessionStates(local, identity)).map(
    ({ device, pending, ended_at, ended_reason }) => [device, pending, ended_at, ended_reason],
  )
}

/** The moment of the mount's clock, a minute on from now. */
async function aMinuteLater(mounted: Mounted): Promise<Date> {
  await mounted.clock.advance(MINUTE_MS)

  return new Date(mounted.clock.now())
}

describe("the ban's boundary, against a sign-in held at its admission", () => {
  it('refuses a sign-in whose admission waits while the ban commits: 403 account-banned with no token, its session ended banned by the ban', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const operators = await consoleOver(mounted)
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const admission = queries.hold(isAdmission)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

    // Better Auth read the account unbanned and wrote the session, which waits for its admission.
    await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)

    const bannedAt = await aMinuteLater(mounted)

    expect((await operators.ban(ann.identity))?.status).toBe(204)
    expect(ann.sockets.get('laptop')?.ended).toEqual([CLOSE.banned])

    await aMinuteLater(mounted)
    admission.release()

    const answer = await signingIn

    expect([answer?.status, await answer?.json()]).toEqual([403, { code: 'account-banned' }])
    expect(await rowsOf(mounted.local, ann.identity)).toEqual([
      ['laptop', false, bannedAt, 'banned'],
      ['phone', true, bannedAt, 'banned'],
    ])
    expect(operators.closes).toEqual([[ann.identity, undefined, CLOSE.banned]])
    // The refused sign-in closed nothing.
    expect(mounted.closes).toEqual([])
    expect(operators.failures).toEqual([])
  }, 30_000)

  it('leaves to the ban a sign-in admitted before it: 200 with its token, then its session ended banned and its socket closed 4004', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const operators = await consoleOver(mounted)
    const ann = await signedInOn(mounted, ANN, ['laptop'])
    const admission = queries.hold(isAdmission)
    const signingIn = mounted.route(signInRequest(ANN, PASSWORD, 'phone'), FROM)

    await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)
    admission.release()

    const answer = await signingIn
    const { token } = z.object({ token: z.string().min(1) }).parse(await answer?.json())
    const phone = welcomed(mounted.registry, ann.identity, 'phone')

    expect(answer?.status).toBe(200)
    expect((await mounted.sessions.read(token)).kind).toBe('session')

    const bannedAt = await aMinuteLater(mounted)

    expect((await operators.ban(ann.identity))?.status).toBe(204)
    expect(phone?.ended).toEqual([CLOSE.banned])
    expect(ann.sockets.get('laptop')?.ended).toEqual([CLOSE.banned])
    expect(await rowsOf(mounted.local, ann.identity)).toEqual([
      ['laptop', false, bannedAt, 'banned'],
      ['phone', false, bannedAt, 'banned'],
    ])
    expect((await mounted.sessions.read(token)).kind).toBe('none')
    expect(operators.failures).toEqual([])
  }, 30_000)
})
