import { describe, expect, it } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'

import { FAILED_SIGN_INS } from '../../limits/windows'
import { ban, setBanned } from '../__fixtures__/account-ban'
import { backupCodesOf, codeOf, wrongCodeOf } from '../__fixtures__/second-factor'

import {
  ageChallenges,
  answered,
  challengeRows,
  codeStep,
  passwordStep,
  tokenOf,
  withSecondFactor,
  wrongPasswords,
} from './__fixtures__/code-step'
import {
  AT_THE_LIMIT,
  endedOf,
  LAST_PLACE,
  listedOf,
  ONE_SHORT,
  PAST_THE_LIMIT,
  seenInTurn,
} from './__fixtures__/devices'
import { ANN, mountedOnRealAuth, PASSWORD, signInRequest } from './__fixtures__/mount'

/** The client address a request comes from. */
const FROM = '203.0.113.7'

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

const codeExpired = { status: 401, body: { code: 'code-expired' } }

const deviceLimit = { status: 409, body: { code: 'device-limit' } }

const invalidCode = { status: 400, body: { code: 'invalid-code' } }

const rateLimited = { status: 429, body: { code: 'rate-limited' } }

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** Sends the code step of `challenge` with `code` from `device`: its status and body. */
async function confirm(
  mounted: Mounted,
  challenge: string,
  code: string,
  device: string,
  signOutOldest?: boolean,
) {
  return answered(
    await mounted.route(
      codeStep(challenge, code, device, signOutOldest === undefined ? {} : { signOutOldest }),
      FROM,
    ),
  )
}

/** The status of Ann's sign-in with her right password from `device`. */
async function rightPassword(mounted: Mounted, device: string) {
  return (await mounted.route(signInRequest(ANN, PASSWORD, device), FROM))?.status
}

/**
 * Signs `device`, signed in already, in again with each of `codes`, each from the password and
 * from an address of its own, so the account keeps only the codes left.
 */
async function spendOn(mounted: Mounted, device: string, codes: readonly string[]) {
  for (const [at, code] of codes.entries()) {
    const from = `198.51.100.${at + 1}`
    const challenge = await passwordStep(mounted, device, from)

    expect(
      (await answered(await mounted.route(codeStep(challenge, code, device), from))).status,
    ).toBe(200)
  }
}

describe("authHandler, a sign-in's code step past the account's limit of devices", () => {
  it(
    "answers the last backup code of a device past the limit 409 device-limit before checking it: nothing signed in or out, the code kept, the challenge ended, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)
      const spent = ann.backupCodes.slice(0, -1)
      const [last = ''] = ann.backupCodes.slice(-1)

      await spendOn(mounted, 'a', spent)
      expect(await backupCodesOf(mounted.auth, ann.identity)).toEqual([last])
      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 1, FROM)

      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect(await confirm(mounted, asked, last, PAST_THE_LIMIT)).toEqual(deviceLimit)
      expect(await listedOf(mounted, ann.identity)).toEqual([...AT_THE_LIMIT])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(await backupCodesOf(mounted.auth, ann.identity)).toEqual([last])
      expect(await challengeRows(mounted)).toEqual([])
      // Nothing was judged: the next wrong password is the last failure allowed, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted, PAST_THE_LIMIT)).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs the device past the limit in with that last backup code once the dialog is confirmed from the password, the device seen least recently signed out and the code used up',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)
      const spent = ann.backupCodes.slice(0, -1)
      const [last = ''] = ann.backupCodes.slice(-1)

      await spendOn(mounted, 'a', spent)
      // Every device but c is seen after the sign-ins, c the least recently: c is the one to go.
      await seenInTurn(
        mounted,
        ann,
        AT_THE_LIMIT.filter((device) => device !== 'c'),
      )

      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect(await confirm(mounted, asked, last, PAST_THE_LIMIT)).toEqual(deviceLimit)

      const again = await passwordStep(mounted, PAST_THE_LIMIT, FROM)
      const confirmed = await confirm(mounted, again, last, PAST_THE_LIMIT, true)

      expect(confirmed.status).toBe(200)
      expect((await mounted.sessions.read(tokenOf(confirmed.body))).kind).toBe('session')
      expect(await endedOf(mounted, ann.identity)).toEqual([['c', 'device-limit']])
      expect(await backupCodesOf(mounted.auth, ann.identity)).toEqual([])

      // Used up: the device signed in now gives it again, and it is a wrong code.
      const third = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect(await confirm(mounted, third, last, PAST_THE_LIMIT)).toEqual(invalidCode)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers a wrong code of a device past the limit 409 device-limit, unchecked, so it does not count toward the email's failed sign-ins",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 1, FROM)

      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect(await confirm(mounted, asked, await wrongCodeOf(ann.secret), PAST_THE_LIMIT)).toEqual(
        deviceLimit,
      )
      expect(await challengeRows(mounted)).toEqual([])
      // Not counted: the next wrong password is the last failure allowed, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted, PAST_THE_LIMIT)).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 429 rate-limited first past the limit while the email's failed sign-ins keep a password out, its challenge left as it was",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)
      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit, FROM)

      expect(await confirm(mounted, asked, await codeOf(ann.secret), PAST_THE_LIMIT)).toEqual(
        rateLimited,
      )
      expect(await challengeRows(mounted)).toHaveLength(2)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers a code of the key on an eleventh device 409 device-limit before checking it, and signs it in from the password again with a new code once confirmed, the device seen least recently signed out and the email's failed sign-ins forgotten",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)

      await seenInTurn(
        mounted,
        ann,
        AT_THE_LIMIT.filter((device) => device !== 'c'),
      )
      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 2, FROM)

      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect(await confirm(mounted, asked, await codeOf(ann.secret), PAST_THE_LIMIT)).toEqual(
        deviceLimit,
      )
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(await challengeRows(mounted)).toEqual([])

      const again = await passwordStep(mounted, PAST_THE_LIMIT, FROM)
      const confirmed = await confirm(
        mounted,
        again,
        await codeOf(ann.secret),
        PAST_THE_LIMIT,
        true,
      )

      expect(confirmed.status).toBe(200)
      expect((await mounted.sessions.read(tokenOf(confirmed.body))).kind).toBe('session')
      expect(await endedOf(mounted, ann.identity)).toEqual([['c', 'device-limit']])
      // Its socket, and no other, is closed for the limit.
      expect(mounted.closes.filter(([, , code]) => code === CLOSE.deviceLimit)).toEqual([
        [ann.identity, 'c', CLOSE.deviceLimit],
      ])
      expect(ann.sockets.get('c')?.ended).toEqual([CLOSE.deviceLimit])
      // The right code was the sign-in's last step: two more failures are the first of a new count.
      await wrongPasswords(mounted, 2, FROM)
      expect(await rightPassword(mounted, PAST_THE_LIMIT)).toBe(200)
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's code step past the limit and a challenge or an account that changed", () => {
  it(
    "answers 403 account-banned to the confirmed retry of an account banned after the dialog's confirmation, before checking its code: the backup code kept, and taken once the ban is lifted, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)
      const [backup = ''] = ann.backupCodes

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 1, FROM)

      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect(await confirm(mounted, asked, backup, PAST_THE_LIMIT)).toEqual(deviceLimit)

      // The dialog is confirmed: the password again, then an operator's ban before the code.
      const again = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

      expect(await confirm(mounted, again, backup, PAST_THE_LIMIT, true)).toEqual({
        status: 403,
        body: { code: 'account-banned' },
      })
      expect(await backupCodesOf(mounted.auth, ann.identity)).toContain(backup)
      expect(await challengeRows(mounted)).toEqual([])
      // Nothing was judged: the next wrong password is the last failure allowed, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted, PAST_THE_LIMIT)).toBe(429)

      // The ban lifted (it ended every device) and the window passed, the code signs the device in.
      await setBanned(mounted.local, ann.identity, false)
      await mounted.clock.advance(FAILED_SIGN_INS.windowMs)

      const lifted = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      expect((await confirm(mounted, lifted, backup, PAST_THE_LIMIT)).status).toBe(200)
      expect(await backupCodesOf(mounted.auth, ann.identity)).not.toContain(backup)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired, not 409, to a code of a device past the limit whose challenge is past its ten minutes, its challenge ended',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)
      const asked = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      await ageChallenges(mounted)

      expect(await confirm(mounted, asked, await codeOf(ann.secret), PAST_THE_LIMIT)).toEqual(
        codeExpired,
      )
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired, not 409, to the code after five wrong ones once the account reached its limit meanwhile, its challenge ended',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, ONE_SHORT)
      const challenge = await passwordStep(mounted, PAST_THE_LIMIT, FROM)

      for (let wrong = 0; wrong < 5; wrong++) {
        expect(
          await confirm(mounted, challenge, await wrongCodeOf(ann.secret), PAST_THE_LIMIT),
        ).toEqual(invalidCode)
      }

      // The last place is taken: the device asked about would now be past the limit.
      const last = await passwordStep(mounted, LAST_PLACE, FROM)

      expect((await confirm(mounted, last, await codeOf(ann.secret), LAST_PLACE)).status).toBe(200)
      expect(await confirm(mounted, challenge, await codeOf(ann.secret), PAST_THE_LIMIT)).toEqual(
        codeExpired,
      )
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's code step within the account's limit of devices", () => {
  it(
    "takes the code of the device that takes the last place: a wrong one counts toward the email's failed sign-ins, the right one signs it in and forgets them",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, ONE_SHORT)

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 2, FROM)

      const challenge = await passwordStep(mounted, LAST_PLACE, FROM)

      // The failure before the last one allowed.
      expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret), LAST_PLACE)).toEqual(
        invalidCode,
      )
      expect((await confirm(mounted, challenge, await codeOf(ann.secret), LAST_PLACE)).status).toBe(
        200,
      )
      expect(await listedOf(mounted, ann.identity)).toEqual([...AT_THE_LIMIT])
      // Forgotten: two more failures are the first of a new count.
      await wrongPasswords(mounted, 2, FROM)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'takes the code of a device signed in already at the limit, which takes no new place: a wrong one counts, the right one signs it in again and forgets the failed sign-ins',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, AT_THE_LIMIT)

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 2, FROM)

      const challenge = await passwordStep(mounted, 'b', FROM)

      expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret), 'b')).toEqual(
        invalidCode,
      )
      expect((await confirm(mounted, challenge, await codeOf(ann.secret), 'b')).status).toBe(200)
      expect(await listedOf(mounted, ann.identity)).toEqual([...AT_THE_LIMIT])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      await wrongPasswords(mounted, 2, FROM)
    },
    ARGON2_RUNS_MS,
  )
})
