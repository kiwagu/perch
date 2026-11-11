import { describe, expect, it, vi } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { device_sessionIdFactory, type IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { SUPERSEDED } from '../../sync/sync-connection'
import { ban, sessionStates } from '../__fixtures__/account-ban'
import { betterAuthToken, deviceHeaders } from '../__fixtures__/auth-instance'
import deviceSessionRowStatement from '../__fixtures__/device-session-row.surql'
import identityVerifiedStatement from '../__fixtures__/identity-verified.surql'
import { DeviceSessions } from '../device-sessions'
import sessionEndByTokenStatement from '../surql/device-session-end-by-token.surql'

import {
  ANN,
  ARGON2_WAIT,
  annsLink,
  heldQueries,
  isSessionInsert,
  isSessionLookup,
  isVerifiedAdmission,
  mountedOnFakeAuth,
  mountedOnRealAuth,
  printedDuring,
  verifyRequest,
  welcomed,
} from './__fixtures__/mount'

/** The client address every request comes from. */
const FROM = '203.0.113.7'

const MINUTE_MS = 60_000

/** What a verification of a banned account answers: its code alone, no token. */
const BANNED = [403, { code: 'account-banned' }] as const

/** What a verification that failed answers: its code alone, no token. */
const INTERNAL = [500, { code: 'internal' }] as const

/** What the gateway may print or log of a failure: never the marker a test puts in it. */
const MARKER = /MARKER/

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** An answer as the tests compare it: its status and its body. */
async function seen(answer: Response | undefined): Promise<readonly [number | undefined, unknown]> {
  return [answer?.status, await answer?.json()]
}

/** The session rows of `identity`: the device, whether it waits, when it ended and why. */
async function rowsOf(local: LocalDb, identity: IdentityId) {
  return (await sessionStates(local, identity)).map(
    ({ device, pending, ended_at, ended_reason }) => [device, pending, ended_at, ended_reason],
  )
}

/** Whether Ann's email is verified. */
async function annVerified(local: LocalDb): Promise<boolean | undefined> {
  const [rows] =
    await local.db.query<[{ email: string; email_verified: boolean }[]]>(identityVerifiedStatement)

  return rows.find((row) => row.email === ANN)?.email_verified
}

/** Ann signed up, her link not opened yet: its token and her identity. */
async function annUnverified(mounted: Mounted) {
  const link = await annsLink(mounted.outbox)

  return { link, identity: await mounted.annsId() }
}

/** The moment of the clock of the session hooks, a minute on from now. */
async function aMinuteLater(mounted: Mounted): Promise<Date> {
  await mounted.clock.advance(MINUTE_MS)

  return new Date(mounted.clock.now())
}

/**
 * A directory whose next insert of a session, once armed, waits until the test lets it fail, as
 * a directory that breaks while Better Auth writes the session would.
 */
function failingInserts() {
  let armed: { asked: boolean; readonly fails: Promise<void> } | undefined
  let fail = (): void => {}

  return {
    directory: (local: LocalDb) =>
      interceptQueries(local, (text) => {
        const insert = armed

        if (insert === undefined || !isSessionInsert(text)) {
          return undefined
        }

        armed = undefined
        insert.asked = true

        return insert.fails.then(() => {
          throw new Error('MARKER the directory failed to write the session')
        })
      }),
    arm: () => {
      const insert = {
        asked: false,
        fails: new Promise<void>((resolve) => {
          fail = resolve
        }),
      }

      armed = insert

      return { paused: () => insert.asked, fail: () => fail() }
    },
  }
}

describe('authHandler, the verification of a banned account', () => {
  it("answers Better Auth's refusal of a banned account 403 account-banned, its code alone", async () => {
    const { route } = mountedOnFakeAuth(() =>
      Response.json(
        { code: 'BANNED_USER', message: 'MARKER You have been banned from this application' },
        { status: 403 },
      ),
    )

    expect(await seen(await route(verifyRequest('a.link.token', 'phone'), FROM))).toEqual(BANNED)
  })

  it("verifies the email of an account banned before its link was opened, and signs nothing in: Better Auth's gate answers 403 account-banned", async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annUnverified(mounted)

    await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

    expect(await seen(await mounted.route(verifyRequest(ann.link, 'phone'), FROM))).toEqual(BANNED)
    expect(await annVerified(mounted.local)).toBe(true)
    expect(await rowsOf(mounted.local, ann.identity)).toEqual([])
    expect(mounted.closes).toEqual([])
  })

  it('answers 403 account-banned with no token when the ban commits after Better Auth read the account and before it wrote the session, which the admission ends banned', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annUnverified(mounted)
    const insert = queries.hold(isSessionInsert)
    const verifying = mounted.route(verifyRequest(ann.link, 'phone'), FROM)

    // Better Auth's gate read the account unbanned and waits to write the session.
    await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)
    await ban(mounted.local, ann.identity, await aMinuteLater(mounted))

    const admittedAt = await aMinuteLater(mounted)

    insert.release()

    expect(await seen(await verifying)).toEqual(BANNED)
    expect(await rowsOf(mounted.local, ann.identity)).toEqual([
      ['phone', true, admittedAt, 'banned'],
    ])
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it('answers 403 account-banned with no token when the ban commits while the session waits for its admission, the session left as the ban ended it', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annUnverified(mounted)
    const admission = queries.hold(isVerifiedAdmission)
    const verifying = mounted.route(verifyRequest(ann.link, 'phone'), FROM)

    await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)

    const bannedAt = await aMinuteLater(mounted)

    await ban(mounted.local, ann.identity, bannedAt)
    await aMinuteLater(mounted)
    admission.release()

    expect(await seen(await verifying)).toEqual(BANNED)
    expect(await rowsOf(mounted.local, ann.identity)).toEqual([['phone', true, bannedAt, 'banned']])
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it('answers 403 account-banned with no token when the ban ends the session before it is read back, which reads as none', async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annUnverified(mounted)
    const readback = queries.hold(isSessionLookup)
    const verifying = mounted.route(verifyRequest(ann.link, 'phone'), FROM)

    await vi.waitFor(() => expect(readback.paused()).toBe(true), ARGON2_WAIT)

    const bannedAt = await aMinuteLater(mounted)

    await ban(mounted.local, ann.identity, bannedAt)
    readback.release()

    expect(await seen(await verifying)).toEqual(BANNED)
    expect(await rowsOf(mounted.local, ann.identity)).toEqual([['phone', true, bannedAt, 'banned']])
    expect(mounted.closes).toEqual([])
  }, 30_000)

  it('reads back a session the ban ended as none', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annUnverified(mounted)
    const { headers } = await mounted.auth.api.verifyEmail({
      query: { token: betterAuthToken(ann.link) },
      headers: deviceHeaders('phone'),
      returnHeaders: true,
    })
    const signed = headers.get('set-auth-token') ?? expect.unreachable('a signed token')

    expect((await mounted.sessions.signedIn(signed))._unsafeUnwrap()).toMatchObject({
      user: { id: ann.identity },
    })

    await ban(mounted.local, ann.identity, await aMinuteLater(mounted))

    expect((await mounted.sessions.signedIn(signed))._unsafeUnwrap()).toBeUndefined()
  })

  it('leaves to the ban a verification admitted before it: 200 with its token, then its session ended banned', async () => {
    const mounted = await mountedOnRealAuth()
    const ann = await annUnverified(mounted)
    const answer = await mounted.route(verifyRequest(ann.link, 'phone'), FROM)
    const { token } = z.object({ token: z.string().min(1) }).parse(await answer?.json())

    expect(answer?.status).toBe(200)

    const bannedAt = await aMinuteLater(mounted)

    await ban(mounted.local, ann.identity, bannedAt)

    expect(await rowsOf(mounted.local, ann.identity)).toEqual([
      ['phone', false, bannedAt, 'banned'],
    ])
    expect((await mounted.sessions.read(token)).kind).toBe('none')
  })

  it.each([
    { name: 'ends the session by its token', endingFails: false },
    { name: 'leaves the session waiting when that ending fails too', endingFails: true },
  ])(
    'answers 500 with no token to a verification whose admission failed, and $name',
    async ({ endingFails }) => {
      const failing = { admission: false }
      const mounted = await mountedOnRealAuth({
        directory: (local) =>
          interceptQueries(local, (text) => {
            const ending = endingFails && text === sessionEndByTokenStatement

            if ((failing.admission && isVerifiedAdmission(text)) || ending) {
              throw new Error('MARKER the directory failed')
            }
          }),
      })
      const ann = await annUnverified(mounted)
      const endedAt = await aMinuteLater(mounted)

      failing.admission = true

      const { result, printed } = await printedDuring(async () =>
        seen(await mounted.route(verifyRequest(ann.link, 'phone'), FROM)),
      )

      expect(result).toEqual(INTERNAL)
      expect(await rowsOf(mounted.local, ann.identity)).toEqual([
        ['phone', true, endingFails ? undefined : endedAt, undefined],
      ])
      expect(mounted.closes).toEqual([])
      expect(printed).not.toMatch(MARKER)
    },
  )

  it.each([
    { name: 'its account banned meanwhile', banned: true, answer: BANNED },
    { name: 'its account not banned', banned: false, answer: INTERNAL },
  ])(
    'answers $answer.0 with no token to a verification Better Auth answered 5xx, $name, writing no session',
    async ({ banned, answer }) => {
      const inserts = failingInserts()
      const mounted = await mountedOnRealAuth({ directory: inserts.directory })
      const ann = await annUnverified(mounted)
      const insert = inserts.arm()
      const verifying = printedDuring(() => mounted.route(verifyRequest(ann.link, 'phone'), FROM))

      // Better Auth's gate read the account unbanned; its write of the session fails.
      await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)

      if (banned) {
        await ban(mounted.local, ann.identity, await aMinuteLater(mounted))
      }

      insert.fail()

      const { result, printed } = await verifying

      expect(await seen(result)).toEqual(answer)
      expect(await rowsOf(mounted.local, ann.identity)).toEqual([])
      expect(mounted.closes).toEqual([])
      expect(printed).not.toMatch(MARKER)
    },
    30_000,
  )

  it.each([
    { name: 'its account banned meanwhile', banned: true, answer: BANNED },
    { name: 'its account not banned', banned: false, answer: INTERNAL },
  ])(
    'answers $answer.0 with no token to a verification whose call of Better Auth rejected once the session was written, $name, the session never handed out',
    async ({ banned, answer }) => {
      let handled = async (): Promise<void> => {}
      const mounted = await mountedOnRealAuth({
        handler: (handle) => async (request) => {
          await handle(request)
          await handled()

          throw new Error('MARKER Better Auth failed outside its router')
        },
      })
      const ann = await annUnverified(mounted)
      const bannedAt = await aMinuteLater(mounted)

      if (banned) {
        handled = () => ban(mounted.local, ann.identity, bannedAt)
      }

      const { result, printed } = await printedDuring(async () =>
        seen(await mounted.route(verifyRequest(ann.link, 'phone'), FROM)),
      )

      expect(result).toEqual(answer)
      expect(await rowsOf(mounted.local, ann.identity)).toEqual([
        banned ? ['phone', true, bannedAt, 'banned'] : ['phone', true, undefined, undefined],
      ])
      expect(mounted.closes).toEqual([])
      expect(printed).not.toMatch(MARKER)
    },
  )
})

describe("authHandler, a verification's session until its admission", () => {
  it("lists no waiting session among the account's devices and ends none of the device's sessions or sockets until its admission, then hands it out", async () => {
    const queries = heldQueries()
    const mounted = await mountedOnRealAuth({ directory: queries.directory })
    const ann = await annUnverified(mounted)
    const devices = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })
    const listed = async () =>
      (await devices.list(ann.identity))
        ._unsafeUnwrap()
        .map(({ token, endedAt }) => [token, endedAt !== undefined])

    // The phone holds an earlier admitted session of the account, and a socket opened with it.
    await mounted.local.db.query(deviceSessionRowStatement, {
      identity: ann.identity,
      device: 'phone',
      key: device_sessionIdFactory.create(),
      session_token: 'earlier-token',
      created_at: new Date(Date.now() - MINUTE_MS),
    })

    const socket =
      welcomed(mounted.registry, ann.identity, 'phone') ?? expect.unreachable('a socket')
    const admission = queries.hold(isVerifiedAdmission)
    const verifying = mounted.route(verifyRequest(ann.link, 'phone'), FROM)

    await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)
    expect(await listed()).toEqual([['earlier-token', false]])
    expect(socket.ended).toEqual([])
    expect(mounted.closes).toEqual([])

    admission.release()

    const answer = await verifying
    const { token } = z.object({ token: z.string().min(1) }).parse(await answer?.json())

    expect(answer?.status).toBe(200)
    // The device is listed by its newest session; the admission ended the earlier one.
    expect(await listed()).toEqual([[token, false]])
    expect(
      (await sessionStates(mounted.local, ann.identity)).map(({ token: held, ended_at }) => [
        held,
        ended_at !== undefined,
      ]),
    ).toEqual([
      ['earlier-token', true],
      [token, false],
    ])
    expect(socket.ended).toEqual([SUPERSEDED])
    expect(mounted.closes).toEqual([[ann.identity, 'phone', SUPERSEDED]])
  }, 30_000)
})
