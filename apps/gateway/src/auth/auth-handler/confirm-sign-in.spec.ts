import { describe, expect, it } from 'vitest'

import { linkToken } from '../../mail/__fixtures__/outbox'
import { SUPERSEDED } from '../../sync/sync-connection'
import { ban } from '../__fixtures__/account-ban'
import { codeOf, wrongCodeOf } from '../__fixtures__/second-factor'

import {
  ageChallenges,
  answered,
  challengeRows,
  codeStep,
  passwordStep,
  settingsOf,
  tokenOf,
  withSecondFactor,
  wrongPasswords,
} from './__fixtures__/code-step'
import {
  ANN,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  signInRequest,
} from './__fixtures__/mount'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'

/** The client address a request comes from. */
const FROM = '203.0.113.7'

/** How long the email's failed sign-ins keep a password out. */
const WINDOW_MS = 15 * 60_000

/** An email no account has. */
const GHOST = 'ghost@example.test'

/** The email Ann's account moves to. */
const MOVED = 'ann.moved@example.test'

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

const invalidCode = { status: 400, body: { code: 'invalid-code' } }

const codeExpired = { status: 401, body: { code: 'code-expired' } }

const rateLimited = { status: 429, body: { code: 'rate-limited' } }

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** Sends the code step of `challenge` with `code` from `device`: its status and body. */
async function confirm(
  mounted: Mounted,
  challenge: string,
  code: string,
  device = 'desk',
  email = ANN,
) {
  return answered(await mounted.route(codeStep(challenge, code, device, { email }), FROM))
}

/** The status of Ann's sign-in with her right password from the desk. */
async function rightPassword(mounted: Mounted) {
  return (await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), FROM))?.status
}

describe("authHandler, a sign-in's code step and the email's failed sign-ins", () => {
  it(
    'counts a wrong code as a failed sign-in, keeps the right one out while they are spent, and takes it on the same challenge once the window passed',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)

      await wrongPasswords(mounted, 9, FROM)

      const challenge = await passwordStep(mounted, 'desk', FROM)

      expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret))).toEqual(invalidCode)
      // The tenth failure: the right code is kept out before any code is looked at.
      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(rateLimited)
      expect(await challengeRows(mounted)).toHaveLength(2)

      await mounted.clock.advance(WINDOW_MS)

      expect((await confirm(mounted, challenge, await codeOf(ann.secret))).status).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "signs the device in with the right code, its token reading the devices page, and forgets the email's failed sign-ins",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)

      await wrongPasswords(mounted, 9, FROM)

      const challenge = await passwordStep(mounted, 'desk', FROM)
      const response = await mounted.route(
        codeStep(challenge, await codeOf(ann.secret), 'desk'),
        FROM,
      )

      expect(response?.headers.get('set-cookie')).toBeNull()
      expect(response?.headers.get('set-auth-token')).toBeNull()

      const { status, body } = await answered(response)
      const token = tokenOf(body)

      expect(status).toBe(200)
      expect(body).toEqual({
        token,
        user: { id: ann.identity, email: ANN, name: 'Ann', emailVerified: true },
        start: { name: 'Ann', locale: 'en' },
      })
      expect(await settingsOf(mounted).devicesStatus('desk', token)).toBe(200)
      expect(mounted.closes).toEqual([[ann.identity, 'desk', SUPERSEDED]])
      expect(await challengeRows(mounted)).toEqual([])
      // Nine failures were forgotten: two more are the first two of a new count.
      await wrongPasswords(mounted, 2, FROM)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'takes a backup code once: the same code on a new challenge answers 400 invalid-code',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const [backup = ''] = ann.backupCodes
      const first = await passwordStep(mounted, 'desk', FROM)

      expect((await confirm(mounted, first, backup)).status).toBe(200)

      const second = await passwordStep(mounted, 'tablet', FROM)

      expect(await confirm(mounted, second, backup, 'tablet')).toEqual(invalidCode)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired to the code after five wrong ones, the right one included, its challenge gone',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)

      for (let wrong = 0; wrong < 5; wrong++) {
        expect(await confirm(mounted, challenge, await wrongCodeOf(ann.secret))).toEqual(
          invalidCode,
        )
      }

      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
      expect(await challengeRows(mounted)).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired to the right code of a challenge past its ten minutes',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)

      await ageChallenges(mounted)

      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 429 to a dead challenge while the email's failed sign-ins keep a password out",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)

      ;(await mounted.deps.challenges.end(challenge))._unsafeUnwrap()
      await wrongPasswords(mounted, 10, FROM)

      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(rateLimited)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'gives back the place of a dead challenge and of a made-up one: neither counts',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)

      ;(await mounted.deps.challenges.end(challenge))._unsafeUnwrap()
      await wrongPasswords(mounted, 9, FROM)

      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
      expect(await confirm(mounted, '2fa-made-up.signature', await codeOf(ann.secret))).toEqual(
        codeExpired,
      )
      // The tenth failure is the next wrong password, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted)).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 401 code-expired to a challenge sent with an email its account does not have, and gives that email's place back",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)

      await wrongPasswords(mounted, 9, FROM, GHOST)

      expect(await confirm(mounted, challenge, await codeOf(ann.secret), 'desk', GHOST)).toEqual(
        codeExpired,
      )
      await wrongPasswords(mounted, 1, FROM, GHOST)
      expect((await mounted.route(signInRequest(GHOST, PASSWORD, 'desk'), FROM))?.status).toBe(429)
      // Ann's own challenge was left as it was.
      expect((await confirm(mounted, challenge, await codeOf(ann.secret))).status).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'reads the email in lower case: a code step sent with the email in another case counts toward it and signs in',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)

      await wrongPasswords(mounted, 9, FROM)

      const challenge = await passwordStep(mounted, 'desk', FROM)

      expect(
        await confirm(
          mounted,
          challenge,
          await wrongCodeOf(ann.secret),
          'desk',
          'Ann@Example.Test',
        ),
      ).toEqual(invalidCode)
      expect(
        await confirm(mounted, challenge, await codeOf(ann.secret), 'desk', 'ANN@EXAMPLE.TEST'),
      ).toEqual(rateLimited)

      await mounted.clock.advance(WINDOW_MS)

      expect(
        (await confirm(mounted, challenge, await codeOf(ann.secret), 'desk', 'Ann@Example.Test'))
          .status,
      ).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 400 bad-request to a code step that names no device, its challenge left as it was',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const deviceless = await mounted.route(
        postTo('/auth/confirm-sign-in', { challenge, email: ANN, code: await codeOf(ann.secret) }),
        FROM,
      )

      expect(await answered(deviceless)).toEqual({ status: 400, body: { code: 'bad-request' } })
      expect(await challengeRows(mounted)).toHaveLength(2)
      expect((await confirm(mounted, challenge, await codeOf(ann.secret))).status).toBe(200)
    },
    ARGON2_RUNS_MS,
  )
})

describe('authHandler, a change of what a challenge stood for between the steps', () => {
  it(
    'answers 401 code-expired after a change of the password, its rows gone with the change',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const changed = await mounted.route(
        postTo(
          '/auth/change-password',
          { currentPassword: PASSWORD, password: 'New-pass-word-2' },
          ann.on('laptop'),
        ),
        FROM,
      )

      expect(changed?.status).toBe(204)
      expect(await challengeRows(mounted)).toEqual([])
      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired after a reset of the password, its rows gone with the reset',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)
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
      const reset = await mounted.route(
        postTo('/auth/reset-password', { token, password: 'New-pass-word-2' }),
        FROM,
      )

      expect(reset?.status).toBe(200)
      expect(await challengeRows(mounted)).toEqual([])
      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired after the confirmation of a new email, by either email, its rows gone with the confirmation',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)
      const token = (await mounted.emailChanges.ask(ann.identity, ANN, MOVED))._unsafeUnwrap()

      expect((await mounted.route(postTo('/auth/confirm-email', { token }), FROM))?.status).toBe(
        200,
      )
      expect(await challengeRows(mounted)).toEqual([])
      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
      expect(await confirm(mounted, challenge, await codeOf(ann.secret), 'desk', MOVED)).toEqual(
        codeExpired,
      )
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 code-expired once the factor is turned off, its rows gone with it',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const challenge = await passwordStep(mounted, 'desk', FROM)

      expect((await settingsOf(mounted).disable(ann.on('laptop'))).status).toBe(204)
      expect(await challengeRows(mounted)).toEqual([])
      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual(codeExpired)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 403 account-banned to the right code of an account banned between the steps, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)

      await wrongPasswords(mounted, 9, FROM)

      const challenge = await passwordStep(mounted, 'desk', FROM)

      await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

      expect(await confirm(mounted, challenge, await codeOf(ann.secret))).toEqual({
        status: 403,
        body: { code: 'account-banned' },
      })
      // The refusal judged nothing: the next wrong password is the tenth, which spends them.
      await wrongPasswords(mounted, 1, FROM)
      expect(await rightPassword(mounted)).toBe(429)
    },
    ARGON2_RUNS_MS,
  )
})
