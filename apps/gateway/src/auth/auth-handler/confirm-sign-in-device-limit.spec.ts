import { describe, expect, it } from 'vitest'

import { CLOSE } from '@workspace/replica/protocol'

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
import { endedOf, listedOf, seenInTurn } from './__fixtures__/devices'
import { ANN, mountedOnRealAuth, PASSWORD, signInRequest } from './__fixtures__/mount'

/** The client address a request comes from. */
const FROM = '203.0.113.7'

/** Ten devices, the most one account keeps signed in at once; `a` signed in first. */
const TEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const

/** Nine devices: one place left. */
const NINE = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

/** How long the email's failed sign-ins keep a password out. */
const WINDOW_MS = 15 * 60_000

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
    "answers the last backup code of an eleventh device 409 device-limit before checking it: nothing signed in or out, the code kept, the challenge ended, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)
      const spent = ann.backupCodes.slice(0, -1)
      const [last = ''] = ann.backupCodes.slice(-1)

      await spendOn(mounted, 'a', spent)
      expect(await backupCodesOf(mounted.auth, ann.identity)).toEqual([last])
      await wrongPasswords(mounted, 9, FROM)

      const asked = await passwordStep(mounted, 'k', FROM)

      expect(await confirm(mounted, asked, last, 'k')).toEqual(deviceLimit)
      expect(await listedOf(mounted, ann.identity)).toEqual([...TEN])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(await backupCodesOf(mounted.auth, ann.identity)).toEqual([last])
      expect(await challengeRows(mounted)).toEqual([])
      // Nothing was judged: the next wrong password is the tenth failure, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted, 'k')).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs the eleventh device in with that last backup code once the dialog is confirmed from the password, the device seen least recently signed out and the code used up',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)
      const spent = ann.backupCodes.slice(0, -1)
      const [last = ''] = ann.backupCodes.slice(-1)

      await spendOn(mounted, 'a', spent)
      // Every device but c is seen after the sign-ins, c the least recently: c is the one to go.
      await seenInTurn(
        mounted,
        ann,
        TEN.filter((device) => device !== 'c'),
      )

      const asked = await passwordStep(mounted, 'k', FROM)

      expect(await confirm(mounted, asked, last, 'k')).toEqual(deviceLimit)

      const again = await passwordStep(mounted, 'k', FROM)
      const confirmed = await confirm(mounted, again, last, 'k', true)

      expect(confirmed.status).toBe(200)
      expect((await mounted.sessions.read(tokenOf(confirmed.body))).kind).toBe('session')
      expect(await endedOf(mounted, ann.identity)).toEqual([['c', 'device-limit']])
      expect(await backupCodesOf(mounted.auth, ann.identity)).toEqual([])

      // Used up: the device signed in now gives it again, and it is a wrong code.
      const third = await passwordStep(mounted, 'k', FROM)

      expect(await confirm(mounted, third, last, 'k')).toEqual(invalidCode)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers a wrong code of an eleventh device 409 device-limit, unchecked, so it does not count toward the email's failed sign-ins",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)

      await wrongPasswords(mounted, 9, FROM)

      const asked = await passwordStep(mounted, 'k', FROM)

      expect(await confirm(mounted, asked, await wrongCodeOf(ann.secret), 'k')).toEqual(deviceLimit)
      expect(await challengeRows(mounted)).toEqual([])
      // Not counted: the next wrong password is the tenth failure, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted, 'k')).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 429 rate-limited first past the limit while the email's failed sign-ins keep a password out, its challenge left as it was",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)
      const asked = await passwordStep(mounted, 'k', FROM)

      await wrongPasswords(mounted, 10, FROM)

      expect(await confirm(mounted, asked, await codeOf(ann.secret), 'k')).toEqual(rateLimited)
      expect(await challengeRows(mounted)).toHaveLength(2)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers a code of the key on an eleventh device 409 device-limit before checking it, and signs it in from the password again with a new code once confirmed, the device seen least recently signed out and the email's failed sign-ins forgotten",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)

      await seenInTurn(
        mounted,
        ann,
        TEN.filter((device) => device !== 'c'),
      )
      await wrongPasswords(mounted, 8, FROM)

      const asked = await passwordStep(mounted, 'k', FROM)

      expect(await confirm(mounted, asked, await codeOf(ann.secret), 'k')).toEqual(deviceLimit)
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      expect(await challengeRows(mounted)).toEqual([])

      const again = await passwordStep(mounted, 'k', FROM)
      const confirmed = await confirm(mounted, again, await codeOf(ann.secret), 'k', true)

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
      expect(await rightPassword(mounted, 'k')).toBe(200)
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's code step past the limit and a challenge or an account that changed", () => {
  it(
    "answers 403 account-banned to the confirmed retry of an account banned after the dialog's confirmation, before checking its code: the backup code kept, and taken once the ban is lifted, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)
      const [backup = ''] = ann.backupCodes

      await wrongPasswords(mounted, 9, FROM)

      const asked = await passwordStep(mounted, 'k', FROM)

      expect(await confirm(mounted, asked, backup, 'k')).toEqual(deviceLimit)

      // The dialog is confirmed: the password again, then an operator's ban before the code.
      const again = await passwordStep(mounted, 'k', FROM)

      await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

      expect(await confirm(mounted, again, backup, 'k', true)).toEqual({
        status: 403,
        body: { code: 'account-banned' },
      })
      expect(await backupCodesOf(mounted.auth, ann.identity)).toContain(backup)
      expect(await challengeRows(mounted)).toEqual([])
      // Nothing was judged: the next wrong password is the tenth failure, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted, 'k')).toBe(429)

      // The ban lifted (it ended every device) and the window passed, the code signs the device in.
      await setBanned(mounted.local, ann.identity, false)
      await mounted.clock.advance(WINDOW_MS)

      const lifted = await passwordStep(mounted, 'k', FROM)

      expect((await confirm(mounted, lifted, backup, 'k')).status).toBe(200)
      expect(await backupCodesOf(mounted.auth, ann.identity)).not.toContain(backup)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired, not 409, to a code of an eleventh device whose challenge is past its ten minutes, its challenge ended',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)
      const asked = await passwordStep(mounted, 'k', FROM)

      await ageChallenges(mounted)

      expect(await confirm(mounted, asked, await codeOf(ann.secret), 'k')).toEqual(codeExpired)
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired, not 409, to the code after five wrong ones once the account reached its limit meanwhile, its challenge ended',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, NINE)
      const challenge = await passwordStep(mounted, 'k', FROM)

      for (let wrong = 0; wrong < 5; wrong++) {
        expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret), 'k')).toEqual(
          invalidCode,
        )
      }

      // j takes the last place: k would now be the eleventh device.
      const tenth = await passwordStep(mounted, 'j', FROM)

      expect((await confirm(mounted, tenth, await codeOf(ann.secret), 'j')).status).toBe(200)
      expect(await confirm(mounted, challenge, await codeOf(ann.secret), 'k')).toEqual(codeExpired)
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a sign-in's code step within the account's limit of devices", () => {
  it(
    "takes the code of a tenth device: a wrong one counts toward the email's failed sign-ins, the right one signs it in and forgets them",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, NINE)

      await wrongPasswords(mounted, 8, FROM)

      const challenge = await passwordStep(mounted, 'j', FROM)

      // The ninth failure.
      expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret), 'j')).toEqual(
        invalidCode,
      )
      expect((await confirm(mounted, challenge, await codeOf(ann.secret), 'j')).status).toBe(200)
      expect(await listedOf(mounted, ann.identity)).toEqual([...TEN])
      // Forgotten: two more failures are the first of a new count.
      await wrongPasswords(mounted, 2, FROM)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'takes the code of a device signed in already at the limit, which takes no new place: a wrong one counts, the right one signs it in again and forgets the failed sign-ins',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted, TEN)

      await wrongPasswords(mounted, 8, FROM)

      const challenge = await passwordStep(mounted, 'b', FROM)

      expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret), 'b')).toEqual(
        invalidCode,
      )
      expect((await confirm(mounted, challenge, await codeOf(ann.secret), 'b')).status).toBe(200)
      expect(await listedOf(mounted, ann.identity)).toEqual([...TEN])
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      await wrongPasswords(mounted, 2, FROM)
    },
    ARGON2_RUNS_MS,
  )
})
