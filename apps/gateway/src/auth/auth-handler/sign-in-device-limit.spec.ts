import { errAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import { SUPERSEDED } from '../../sync/sync-connection'
import { deviceHeaders, signUpOn } from '../__fixtures__/auth-instance'
import type { AuthSessions } from '../auth-sessions'
import { DeviceSessions } from '../device-sessions'
import { ADMISSION_HEADER } from '../session-hooks'

import {
  ANN,
  mountedOnRealAuth,
  PASSWORD,
  type SignedInAccount,
  signedInOn,
  signInRequest,
} from './__fixtures__/mount'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 30_000

const MINUTE_MS = 60_000

/** Ten devices, the most one account keeps signed in at once; `a` signed in first. */
const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The rows of the devices of `identity`, the latest of each device, as My devices lists them. */
async function devicesOf(mounted: Mounted, identity: IdentityId) {
  const devices = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

  return (await devices.list(identity))._unsafeUnwrap()
}

/** The devices whose session ended, each with why. */
async function endedOf(mounted: Mounted, identity: IdentityId) {
  return (await devicesOf(mounted, identity))
    .filter((row) => row.endedAt !== undefined)
    .map((row) => [row.device, row.endedReason])
}

/** The sockets the limit of devices closed. */
const limitCloses = (mounted: Mounted) =>
  mounted.closes.filter(([, , code]) => code === CLOSE.deviceLimit)

/**
 * Admissions a test holds: once `arm`ed with a number, that many next admissions wait, each with
 * its sign-in's session written, until `release` lets them all go at once; `reached` settles once
 * they all wait. Every other one runs at once.
 */
function heldAdmissions() {
  let left = 0
  let release = () => {}
  let reach = () => {}
  let held: Promise<void> = Promise.resolve()
  let reached: Promise<void> = Promise.resolve()

  return {
    get reached() {
      return reached
    },
    arm: (count: number) => {
      left = count
      held = new Promise<void>((resolve) => {
        release = resolve
      })
      reached = new Promise<void>((resolve) => {
        reach = resolve
      })
    },
    release: () => release(),
    admission: (admit: () => ReturnType<AuthSessions['admit']>) => {
      if (left === 0) {
        return admit()
      }

      left -= 1

      if (left === 0) {
        reach()
      }

      return ResultAsync.fromSafePromise(held).andThen(admit)
    },
  }
}

/**
 * Marks every device of `ann` seen a minute after the other, in the order given, all after every
 * sign-in: a device left out was seen last when it signed in.
 */
async function seenInTurn(mounted: Mounted, ann: SignedInAccount, devices: readonly string[]) {
  const rows = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

  await mounted.clock.advance(Date.now() + MINUTE_MS - mounted.clock.now())

  for (const device of devices) {
    await mounted.clock.advance(MINUTE_MS)
    ;(await rows.seen({ identity: ann.identity, device }))._unsafeUnwrap()
  }
}

describe('authHandler, the limit of devices an account keeps signed in at once', () => {
  it(
    'admits the sign-in that brings the account to ten devices',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
      const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'j'), FROM)

      expect(answer?.status).toBe(200)
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'asks before an eleventh device, which it leaves no session, signing no device out',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, TEN)
      const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'k'), FROM)

      expect(answer?.status).toBe(409)
      expect(await answer?.json()).toEqual({ code: 'device-limit' })
      expect(answer?.headers.get('set-cookie')).toBeNull()
      // No row of the eleventh device: the devices list shows nothing of the sign-in.
      expect((await devicesOf(mounted, ann.identity)).map(({ device }) => device)).toEqual([...TEN])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs out the device seen least recently once confirmed, not the one signed in first',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, TEN)

      await seenInTurn(
        mounted,
        ann,
        TEN.filter((device) => device !== 'c'),
      )

      const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'k', true), FROM)

      expect(answer?.status).toBe(200)
      expect(await endedOf(mounted, ann.identity)).toEqual([['c', 'device-limit']])
      expect((await devicesOf(mounted, ann.identity)).map(({ device }) => device)).toContain('k')
      expect(limitCloses(mounted)).toEqual([[ann.identity, 'c', CLOSE.deviceLimit]])
      expect(ann.sockets.get('c')?.ended).toEqual([CLOSE.deviceLimit])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs no device out for a confirmed sign-in once a place freed',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, TEN)
      const c =
        (await devicesOf(mounted, ann.identity)).find(({ device }) => device === 'c') ??
        expect.unreachable('a row of c')

      ;(await mounted.sessions.revoke(ann.identity, c.id))._unsafeUnwrap()

      const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'k', true), FROM)

      expect(answer?.status).toBe(200)
      expect(await endedOf(mounted, ann.identity)).toEqual([['c', 'revoked']])
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'takes no place for a new sign-in of a device signed in already',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, TEN)
      const answer = await mounted.route(signInRequest(ANN, PASSWORD, 'a'), FROM)

      expect(answer?.status).toBe(200)
      expect(limitCloses(mounted)).toEqual([])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'counts no sign-in still being admitted: a device signed in already signs in again meanwhile, and the new device is then asked',
    async () => {
      const held = heldAdmissions()
      const mounted = await mountedOnRealAuth({ admission: held.admission })
      const ann = await signedInOn(mounted, ANN, TEN)

      held.arm(1)

      const eleventh = mounted.route(signInRequest(ANN, PASSWORD, 'k'), FROM)

      await held.reached
      // The eleventh device's session is written and waits for its admission: no device lists it.
      expect((await devicesOf(mounted, ann.identity)).map(({ device }) => device)).toEqual([...TEN])

      const again = await mounted.route(signInRequest(ANN, PASSWORD, 'a'), FROM)

      expect(again?.status).toBe(200)

      held.release()

      expect((await eleventh)?.status).toBe(409)
      expect((await devicesOf(mounted, ann.identity)).map(({ device }) => device)).toEqual([...TEN])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    "keeps a device signed in already in its place while its new sign-in waits: a new device is asked meanwhile, and the device's sign-in admitted",
    async () => {
      const held = heldAdmissions()
      const mounted = await mountedOnRealAuth({ admission: held.admission })
      const ann = await signedInOn(mounted, ANN, TEN)

      held.arm(1)

      const again = mounted.route(signInRequest(ANN, PASSWORD, 'a'), FROM)

      await held.reached
      // Device a's new session is written and waits for its admission: until then its earlier
      // session stays live, and so does the socket it opened.
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(ann.sockets.get('a')?.ended).toEqual([])

      const eleventh = await mounted.route(signInRequest(ANN, PASSWORD, 'k'), FROM)

      expect(eleventh?.status).toBe(409)

      held.release()

      expect((await again)?.status).toBe(200)
      expect((await devicesOf(mounted, ann.identity)).map(({ device }) => device)).toEqual([...TEN])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      // The admission ended the device's earlier session: the socket it opened closed.
      expect(ann.sockets.get('a')?.ended).toEqual([SUPERSEDED])
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'admits one of two devices whose sign-ins come to the last place at once, and asks the other',
    async () => {
      const held = heldAdmissions()
      const mounted = await mountedOnRealAuth({ admission: held.admission })
      const ann = await signedInOn(mounted, ANN, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])

      held.arm(2)

      // Both sessions are written before either sign-in is admitted.
      const answers = Promise.all(
        ['j', 'k'].map((device) => mounted.route(signInRequest(ANN, PASSWORD, device), FROM)),
      )

      await held.reached
      held.release()

      expect((await answers).map((answer) => answer?.status).sort()).toEqual([200, 409])
      expect(await devicesOf(mounted, ann.identity)).toHaveLength(10)
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'counts and lists no session whose admission and its ending both failed, which was never handed out',
    async () => {
      let failing = false
      const mounted = await mountedOnRealAuth({
        admission: (admit) =>
          failing ? errAsync(dataError('data:QUERY_FAILED', 'the directory is away')) : admit(),
        signOutFails: true,
      })
      const ann = await signedInOn(mounted, ANN, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])

      failing = true

      const lost = await mounted.route(signInRequest(ANN, PASSWORD, 'x'), FROM)

      expect(lost?.status).toBe(500)

      failing = false

      const tenth = await mounted.route(signInRequest(ANN, PASSWORD, 'j'), FROM)

      expect(tenth?.status).toBe(200)
      expect((await devicesOf(mounted, ann.identity)).map(({ device }) => device)).toEqual([...TEN])
      expect(limitCloses(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    "honours the admission header on the sign-in alone: a verification naming it waits for the verification's own admission, then is listed",
    async () => {
      const mounted = await mountedOnRealAuth()
      const headers = deviceHeaders('a')

      headers.set(ADMISSION_HEADER, 'pending')

      const signedUp = await signUpOn(mounted.auth, ANN, headers, { password: PASSWORD })
      const identity = idSchemas.identity.schema.parse(signedUp.user.id)

      expect((await devicesOf(mounted, identity)).map(({ device }) => device)).toEqual(['a'])
    },
    ARGON2_RUNS_MS,
  )

  it(
    "forgets the email's failed sign-ins at a sign-in asked about the limit, as at an accepted one",
    async () => {
      const mounted = await mountedOnRealAuth()

      await signedInOn(mounted, ANN, TEN)

      const wrong = () => mounted.route(signInRequest(ANN, 'Wrong-pass-word-9', 'k'), FROM)

      for (let failed = 0; failed < 9; failed++) {
        expect((await wrong())?.status).toBe(401)
      }

      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'k'), FROM))?.status).toBe(409)
      expect((await wrong())?.status).toBe(401)
      // Ten failures, had the sign-in asked about the limit not forgotten the nine before it.
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'k'), FROM))?.status).toBe(409)
    },
    ARGON2_RUNS_MS * 2,
  )
})
