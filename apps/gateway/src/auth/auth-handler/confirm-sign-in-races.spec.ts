import { describe, expect, it, vi } from 'vitest'

import type { IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { ban } from '../__fixtures__/account-ban'
import { codeOf, keyOf } from '../__fixtures__/second-factor'
import { DeviceSessions } from '../device-sessions'

import {
  answered,
  challengeOf,
  challengeRows,
  codeStep,
  type FactorAccount,
  passwordStep,
  settingsOf,
  tokenOf,
  turnsReach,
  withSecondFactor,
  wrongPasswords,
} from './__fixtures__/code-step'
import {
  ANN,
  ARGON2_WAIT,
  heldQueries,
  holdTurn,
  isAdmission,
  isBackupCodeSpend,
  isSessionInsert,
  isVerificationInsert,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  signInRequest,
  turnsAsked,
} from './__fixtures__/mount'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from. */
const FROM = '203.0.113.7'

/** The email Ann's account moves to. */
const MOVED = 'ann.moved@example.test'

/** Ten devices, the most one account keeps signed in at once; `a` signed in first. */
const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

const codeExpired = { status: 401, body: { code: 'code-expired' } }

const invalidCode = { status: 400, body: { code: 'invalid-code' } }

const accountBanned = { status: 403, body: { code: 'account-banned' } }

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/**
 * A change of Ann's account that takes the account's turn, made from her laptop: the request, and
 * the status it answers once it committed.
 */
interface Change {
  readonly name: string
  readonly status: number
  /** Whether the device the code step signed in stays signed in once the change committed. */
  readonly keepsTheDevice: boolean
  /** Prepares the change before the race (a mailed link, a request made ready). */
  prepare(mounted: Mounted, ann: FactorAccount): Promise<() => Promise<Response | undefined>>
}

const CHANGES: readonly Change[] = [
  {
    // A change of the password ends the account's other devices: the code step's is not the
    // changing one.
    name: 'a change of the password',
    status: 204,
    keepsTheDevice: false,
    prepare: async (mounted, ann) => () =>
      mounted.route(
        postTo(
          '/auth/change-password',
          { currentPassword: PASSWORD, password: 'New-pass-word-2' },
          ann.on('laptop'),
        ),
        FROM,
      ),
  },
  {
    name: 'a reset of the password',
    status: 200,
    keepsTheDevice: false,
    prepare: async (mounted) => {
      const seen = mounted.outbox.to(ANN).length

      expect(
        (
          await pastFloor(
            mounted.clock,
            mounted.route(postTo('/auth/request-password-reset', { email: ANN }), FROM),
            RESET_REQUEST_FLOOR_MS,
          )
        )?.status,
      ).toBe(202)

      const token = linkToken(await mounted.outbox.next(ANN, seen))

      return () =>
        mounted.route(postTo('/auth/reset-password', { token, password: 'New-pass-word-2' }), FROM)
    },
  },
  {
    name: 'the confirmation of a new email',
    status: 200,
    keepsTheDevice: true,
    prepare: async (mounted, ann) => {
      const token = (await mounted.emailChanges.ask(ann.identity, ANN, MOVED))._unsafeUnwrap()

      return () => mounted.route(postTo('/auth/confirm-email', { token }), FROM)
    },
  },
  {
    name: 'the second factor turned off',
    status: 204,
    keepsTheDevice: true,
    prepare: async (mounted, ann) => {
      const settings = settingsOf(mounted)

      return async () => {
        const { status } = await settings.disable(ann.on('laptop'))

        return new Response(null, { status })
      }
    },
  },
]

/** The devices of `identity` whose session ended, each with why. */
async function endedOf(mounted: Mounted, identity: IdentityId) {
  const devices = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

  return (await devices.list(identity))
    ._unsafeUnwrap()
    .filter((row) => row.endedAt !== undefined)
    .map((row) => [row.device, row.endedReason])
}

describe("authHandler, a sign-in's code step and a change of the account in the account's turn", () => {
  it.each(CHANGES)(
    'answers 401 code-expired to a code step that waited for the turn in which $name committed',
    async (change) => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const changing = await change.prepare(mounted, ann)
      const asked = turnsAsked(mounted.turns)
      // The account's turn is under way: the change asks for it first, the code step after it.
      const release = await holdTurn(mounted.turns, ann.identity)
      const committed = changing()

      await turnsReach(asked, ann.identity, 2)

      const confirming = mounted.route(codeStep(challenge, await codeOf(ann.secret), 'desk'), FROM)

      await turnsReach(asked, ann.identity, 3)
      release()

      expect((await committed)?.status).toBe(change.status)
      expect(await answered(await confirming)).toEqual(codeExpired)
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it.each(CHANGES)(
    'signs the device in with a code step whose turn came before $name, which then commits as it does after any sign-in',
    async (change) => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const changing = await change.prepare(mounted, ann)
      const asked = turnsAsked(mounted.turns)
      const insert = queries.hold(isSessionInsert)
      const confirming = mounted.route(codeStep(challenge, await codeOf(ann.secret), 'desk'), FROM)

      // Better Auth took the code and is about to write the session, in the code step's turn; the
      // change asks for the turn meanwhile.
      await vi.waitFor(() => expect(insert.paused()).toBe(true), ARGON2_WAIT)

      const committed = changing()

      await turnsReach(asked, ann.identity, 2)
      insert.release()

      const { status, body } = await answered(await confirming)

      expect(status).toBe(200)
      expect((await committed)?.status).toBe(change.status)
      expect((await mounted.sessions.read(tokenOf(body))).kind).toBe(
        change.keepsTheDevice ? 'session' : 'none',
      )
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's code step at the account's limit of devices", () => {
  it(
    "answers the right code of an eleventh device 409 with nothing signed in, forgetting the email's failed sign-ins, and signs it in from the password again once confirmed, the oldest device signed out",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)

      await wrongPasswords(mounted, 9, FROM)

      const asked = await passwordStep(mounted, 'k', FROM)

      expect(
        await answered(await mounted.route(codeStep(asked, await codeOf(ann.secret), 'k'), FROM)),
      ).toEqual({ status: 409, body: { code: 'device-limit' } })
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(await challengeRows(mounted)).toEqual([])
      // The right code was the sign-in's last step: two more failures are the first of a new count.
      await wrongPasswords(mounted, 2, FROM)

      const again = await passwordStep(mounted, 'k', FROM)
      const confirmed = await answered(
        await mounted.route(
          codeStep(again, await codeOf(ann.secret), 'k', { signOutOldest: true }),
          FROM,
        ),
      )

      expect(confirmed.status).toBe(200)
      expect((await mounted.sessions.read(tokenOf(confirmed.body))).kind).toBe('session')

      const ended = await endedOf(mounted, ann.identity)

      expect(ended.map(([, reason]) => reason)).toEqual(['device-limit'])
      expect(mounted.closes.filter(([, , code]) => code === CLOSE.deviceLimit)).toHaveLength(1)
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's code step and a ban", () => {
  it(
    "answers 403 account-banned to the right code of a code step that waited for the turn of a ban, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)

      await wrongPasswords(mounted, 9, FROM)

      const challenge = await passwordStep(mounted, 'desk', FROM)
      const asked = turnsAsked(mounted.turns)
      const release = await holdTurn(mounted.turns, ann.identity)
      // An operator's ban takes the account's turn, as the console's does.
      const banning = mounted.turns.run(ann.identity, () =>
        ban(mounted.local, ann.identity, new Date(mounted.clock.now())),
      )

      await turnsReach(asked, ann.identity, 2)

      const confirming = mounted.route(codeStep(challenge, await codeOf(ann.secret), 'desk'), FROM)

      await turnsReach(asked, ann.identity, 3)
      release()
      await banning

      expect(await answered(await confirming)).toEqual(accountBanned)
      await wrongPasswords(mounted, 1, FROM)
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 403 account-banned to a code step whose account is banned while its session waits for its admission, the email's failed sign-ins as they were",
    async () => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await withSecondFactor(mounted)

      await wrongPasswords(mounted, 9, FROM)

      const challenge = await passwordStep(mounted, 'desk', FROM)
      const admission = queries.hold(isAdmission)
      const confirming = mounted.route(codeStep(challenge, await codeOf(ann.secret), 'desk'), FROM)

      await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)
      await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))
      admission.release()

      expect(await answered(await confirming)).toEqual(accountBanned)
      expect(
        (await mounted.sessions.read(ann.tokens.get('phone') ?? expect.unreachable('a phone')))
          .kind,
      ).toBe('none')
      await wrongPasswords(mounted, 1, FROM)
      expect((await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status).toBe(429)
    },
    ARGON2_RUNS_MS,
  )
})

/**
 * The second factor of Ann's account changed while her password step waited to write its
 * challenge: turned off, or turned off and started again with a new key no code confirmed, and the
 * code a step sends then: one of the key, or a backup code, of the factor as it is then.
 */
const UNCONFIRMED = [
  { change: 'turned off', again: false, code: 'a code of its key' },
  { change: 'turned off', again: false, code: 'a backup code' },
  { change: 'turned off and started again unconfirmed', again: true, code: 'a code of its key' },
  { change: 'turned off and started again unconfirmed', again: true, code: 'a backup code' },
] as const

describe("authHandler, a sign-in's code step against a second factor no code confirms", () => {
  it.each(UNCONFIRMED)(
    'answers 401 code-expired to $code once the factor was $change before the challenge was written, its rows gone',
    async ({ again, code }) => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await withSecondFactor(mounted)
      const settings = settingsOf(mounted)
      const write = queries.hold(isVerificationInsert)
      const stepping = mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM)

      // Better Auth checked the password of an account whose factor was on, and waits to write
      // its challenge; the laptop turns the factor off meanwhile, and may start a new key.
      await vi.waitFor(() => expect(write.paused()).toBe(true), ARGON2_WAIT)
      expect((await settings.disable(ann.on('laptop'))).status).toBe(204)

      const fresh = again ? await settings.enable(ann.on('laptop')) : undefined

      write.release()

      const step = await answered(await stepping)
      const challenge = challengeOf(step.body)

      expect(await challengeRows(mounted)).toHaveLength(2)

      const secret = fresh === undefined ? ann.secret : keyOf(fresh.uri)
      const [backup = ''] = fresh === undefined ? ann.backupCodes : fresh.backupCodes
      const sent = code === 'a backup code' ? backup : await codeOf(secret)

      expect(await answered(await mounted.route(codeStep(challenge, sent, 'desk'), FROM))).toEqual(
        codeExpired,
      )
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's backup code spent beside another use of the codes", () => {
  it(
    'answers 400 invalid-code to an old backup code whose step waited for the turn in which the codes were renewed',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const [backup = ''] = ann.backupCodes
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const asked = turnsAsked(mounted.turns)
      const release = await holdTurn(mounted.turns, ann.identity)
      const renewing = settingsOf(mounted).renew(ann.on('laptop'))

      await turnsReach(asked, ann.identity, 2)

      const confirming = mounted.route(codeStep(challenge, backup, 'desk'), FROM)

      await turnsReach(asked, ann.identity, 3)
      release()

      expect((await renewing).status).toBe(200)
      expect(await answered(await confirming)).toEqual(invalidCode)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs in with an old backup code whose step took it before a renewal of the codes asked for the turn, which then renews them',
    async () => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await withSecondFactor(mounted)
      const [backup = ''] = ann.backupCodes
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const asked = turnsAsked(mounted.turns)
      const spend = queries.hold(isBackupCodeSpend)
      const confirming = mounted.route(codeStep(challenge, backup, 'desk'), FROM)

      // Better Auth checked the code and is about to take it out of the account's codes.
      await vi.waitFor(() => expect(spend.paused()).toBe(true), ARGON2_WAIT)

      const renewing = settingsOf(mounted).renew(ann.on('laptop'))

      await turnsReach(asked, ann.identity, 2)
      spend.release()

      expect((await answered(await confirming)).status).toBe(200)
      expect((await renewing).status).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs one of two challenges in with one backup code and answers the other 400 invalid-code',
    async () => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const ann = await withSecondFactor(mounted)
      const [backup = ''] = ann.backupCodes
      const first = await passwordStep(mounted, 'desk', FROM)
      const second = await passwordStep(mounted, 'tablet', FROM)
      const asked = turnsAsked(mounted.turns)
      const spend = queries.hold(isBackupCodeSpend)
      const spending = mounted.route(codeStep(first, backup, 'desk'), FROM)

      await vi.waitFor(() => expect(spend.paused()).toBe(true), ARGON2_WAIT)

      const again = mounted.route(codeStep(second, backup, 'tablet'), FROM)

      await turnsReach(asked, ann.identity, 2)
      spend.release()

      expect((await answered(await spending)).status).toBe(200)
      expect(await answered(await again)).toEqual(invalidCode)
    },
    ARGON2_RUNS_MS,
  )
})
