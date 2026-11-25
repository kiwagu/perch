import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import type { IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { KeyedTurns } from '../../keyed-turns'
import { FAILED_SIGN_INS } from '../../limits/windows'
import { SUPERSEDED } from '../../sync/sync-connection'
import { ban, sessionStates } from '../__fixtures__/account-ban'
import { DeviceSessions } from '../device-sessions'

import {
  answered,
  tokenOf,
  turnsReach,
  withSecondFactor,
  wrongPasswords,
} from './__fixtures__/code-step'
import { AT_THE_LIMIT, PAST_THE_LIMIT, seenInTurn } from './__fixtures__/devices'
import {
  ANN,
  ARGON2_WAIT,
  heldQueries,
  holdTurn,
  isAdmission,
  isSessionInsert,
  mountedOnRealAuth,
  PASSWORD,
  signedInOn,
  signInRequest,
  turnsAsked,
} from './__fixtures__/mount'
import {
  assertionOf,
  authenticator,
  guestOptionsRequest,
  isPasskeyUpdate,
  passkeySignIn,
  passkeySignInRequest,
  passkeysOf,
} from './__fixtures__/passkey'
import { challengeValue } from './challenge-cookie'

/** A second account, whose passkey is not Ann's. */
const BOB = 'bob@example.test'

/** How long a test of many password checks may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

const passkeyUnknown = { status: 401, body: { code: 'passkey-unknown' } }

const failed = { status: 400, body: { code: 'failed' } }

const accountBanned = { status: 403, body: { code: 'account-banned' } }

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The devices of `identity` whose session ended, each with why. */
async function endedOf(mounted: Mounted, identity: IdentityId) {
  const devices = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

  return (await devices.list(identity))
    ._unsafeUnwrap()
    .filter((row) => row.endedAt !== undefined)
    .map((row) => [row.device, row.endedReason])
}

/** The devices `identity` signed in on, its ended sessions included. */
async function devicesOf(mounted: Mounted, identity: IdentityId) {
  const devices = new DeviceSessions({ directory: mounted.local, clock: mounted.clock })

  return (await devices.list(identity))._unsafeUnwrap().map((row) => row.device)
}

/**
 * The turns `turns` is asked for from now on, by key: how many were asked, and how many of them
 * started their work, each once every turn asked before it under its key settled.
 */
function turnsStarted(turns: KeyedTurns<string>) {
  const run = turns.run.bind(turns)
  const begun: string[] = []
  const spy = vi.spyOn(turns, 'run').mockImplementation((key, work) =>
    run(key, () => {
      begun.push(key)

      return work()
    }),
  )

  onTestFinished(() => {
    spy.mockRestore()
  })

  return {
    asked: (key: string) => spy.mock.calls.filter(([asked]) => asked === key).length,
    started: (key: string) => begun.filter((each) => each === key).length,
  }
}

/**
 * Ann signed in on `devices` with a passkey added from the first one: the account, its passkey's
 * authenticator and the passkey's id.
 */
async function annWithPasskey(
  mounted: Mounted,
  devices: readonly [string, ...string[]] = ['laptop'],
  email = ANN,
) {
  const ann = await signedInOn(mounted, email, devices)
  const held = authenticator()
  const id = await passkeysOf(mounted).registered(ann.on(devices[0]), held)

  return { ann, held, id }
}

describe('authHandler, the options of a passkey sign-in', () => {
  it(
    "answers a guest the options of a sign-in that requires its user verified and names no credential, with the challenge as one cookie's value",
    async () => {
      const mounted = await mountedOnRealAuth()
      const response = await mounted.route(guestOptionsRequest('desk'), '198.18.1.1')

      expect(response?.status).toBe(200)
      expect(response?.headers.getSetCookie()).toEqual([])

      const { options, challenge } = z
        .object({ options: z.record(z.string(), z.unknown()), challenge: z.string() })
        .parse((await answered(response)).body)

      expect(options['userVerification']).toBe('required')
      expect(options['rpId']).toBe('localhost')
      expect(options['allowCredentials']).toBeUndefined()
      expect(challengeValue.safeParse(challenge).success).toBe(true)
    },
    ARGON2_RUNS_MS,
  )

  it('answers 400 bad-request to options asked by no device', async () => {
    const mounted = await mountedOnRealAuth()

    expect(await answered(await mounted.route(guestOptionsRequest(null), '198.18.1.1'))).toEqual({
      status: 400,
      body: { code: 'bad-request' },
    })
  })
})

describe('authHandler, a passkey sign-in', () => {
  it(
    "signs a guest device in through the ceremony alone, with the device's headers and no token, answering the account by the allowlist",
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const response = await mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.1.1')

      expect(response?.headers.getSetCookie()).toEqual([])
      expect(response?.headers.get('set-auth-token')).toBeNull()

      const { status, body } = await answered(response)

      expect(status).toBe(200)
      // The account has not started on any device yet: the answer names how it signed up.
      expect(body).toEqual({
        token: tokenOf(body),
        user: { id: ann.identity, email: ANN, name: 'Ann', emailVerified: true },
        start: { name: 'Ann', locale: 'en' },
      })
      expect((await mounted.sessions.read(tokenOf(body))).kind).toBe('session')
      // The device's earlier sockets close: its new session ended any earlier one.
      expect(mounted.closes).toEqual([[ann.identity, 'desk', SUPERSEDED]])
    },
    ARGON2_RUNS_MS,
  )

  it(
    "signs in with no password and no code an account whose second factor is on, forgetting the email's failed sign-ins",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await withSecondFactor(mounted)
      const held = authenticator()

      await passkeysOf(mounted).registered(ann.on('laptop'), held)
      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 1, '198.18.1.2')

      const { status, body } = await passkeySignIn(mounted, 'desk', held)

      expect(status).toBe(200)
      expect((await mounted.sessions.read(tokenOf(body))).kind).toBe('session')
      // The passkey forgot those failures: as many wrong passwords as are allowed are each judged, none refused.
      await wrongPasswords(mounted, FAILED_SIGN_INS.limit, '198.18.1.3')
    },
    ARGON2_RUNS_MS,
  )

  it(
    "signs in while the email's failed sign-ins keep its password out, and forgets them",
    async () => {
      const mounted = await mountedOnRealAuth()
      const { held } = await annWithPasskey(mounted)

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit, '198.18.1.4')
      expect(
        (await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), '198.18.1.5'))?.status,
      ).toBe(429)

      expect((await passkeySignIn(mounted, 'desk', held)).status).toBe(200)
      expect(
        (await mounted.route(signInRequest(ANN, PASSWORD, 'tablet'), '198.18.1.5'))?.status,
      ).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'refuses 400 failed an assertion whose authenticator did not verify its user, signing nothing in',
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held } = await annWithPasskey(mounted)

      expect(await passkeySignIn(mounted, 'desk', held, { userVerified: false })).toEqual(failed)
      expect(await devicesOf(mounted, ann.identity)).toEqual(['laptop'])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'refuses 400 failed an assertion whose signature does not verify, and one sent again once its challenge was spent',
    async () => {
      const mounted = await mountedOnRealAuth()
      const { held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const [first = 0, ...rest] = Buffer.from(assertion.response.response.signature, 'base64url')
      const forged = {
        ...assertion,
        response: {
          ...assertion.response,
          response: {
            ...assertion.response.response,
            // The signature's first byte changed: it signs nothing the passkey's key signed.
            signature: Buffer.from([first ^ 1, ...rest]).toString('base64url'),
          },
        },
      }

      expect(
        await answered(await mounted.route(passkeySignInRequest(forged, 'desk'), '198.18.1.11')),
      ).toEqual(failed)

      const again = await assertionOf(mounted, 'desk', held)

      expect(
        (await answered(await mounted.route(passkeySignInRequest(again, 'desk'), '198.18.1.11')))
          .status,
      ).toBe(200)
      expect(
        await answered(await mounted.route(passkeySignInRequest(again, 'desk'), '198.18.1.11')),
      ).toEqual(failed)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 401 passkey-unknown to a passkey removed from its account, and to one no account holds',
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held, id } = await annWithPasskey(mounted)

      expect((await passkeysOf(mounted).remove(ann.on('laptop'), id)).status).toBe(204)
      expect(await passkeySignIn(mounted, 'desk', held)).toEqual(passkeyUnknown)
      expect(await passkeySignIn(mounted, 'desk', authenticator())).toEqual(passkeyUnknown)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 400 bad-request to a sign-in that names no device or no assertion, before its challenge is spent',
    async () => {
      const mounted = await mountedOnRealAuth()
      const { held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const badRequest = { status: 400, body: { code: 'bad-request' } }

      expect(
        await answered(await mounted.route(passkeySignInRequest(assertion, null), '198.18.1.6')),
      ).toEqual(badRequest)
      expect(
        await answered(
          await mounted.route(
            passkeySignInRequest({ ...assertion, challenge: 'a; b=c' }, 'desk'),
            '198.18.1.6',
          ),
        ),
      ).toEqual(badRequest)
      expect(
        await answered(
          await mounted.route(
            passkeySignInRequest(assertion, 'desk', 'not-an-account'),
            '198.18.1.6',
          ),
        ),
      ).toEqual(badRequest)
      // The challenge was not spent: the same assertion signs the device in.
      expect(
        (await answered(await mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.1.6')))
          .status,
      ).toBe(200)
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 403 account-banned to a banned account's passkey, the email's failed sign-ins as they were",
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held } = await annWithPasskey(mounted)

      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 1, '198.18.1.7')
      await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))

      expect(await passkeySignIn(mounted, 'desk', held)).toEqual(accountBanned)
      await wrongPasswords(mounted, 1, '198.18.1.8')
      expect(
        (await mounted.route(signInRequest(ANN, PASSWORD, 'desk'), '198.18.1.8'))?.status,
      ).toBe(429)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 403 account-banned to a passkey sign-in that waited for the turn of a ban',
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const asked = turnsAsked(mounted.turns)
      const release = await holdTurn(mounted.turns, ann.identity)
      const banning = mounted.turns.run(ann.identity, () =>
        ban(mounted.local, ann.identity, new Date(mounted.clock.now())),
      )

      await turnsReach(asked, ann.identity, 2)

      const signing = mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.1.9')

      await turnsReach(asked, ann.identity, 3)
      release()
      await banning

      expect(await answered(await signing)).toEqual(accountBanned)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 403 account-banned to a passkey sign-in whose account is banned while its session waits for its admission',
    async () => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const { ann, held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const admission = queries.hold(isAdmission)
      const signing = mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.1.10')

      await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)
      await ban(mounted.local, ann.identity, new Date(mounted.clock.now()))
      admission.release()

      expect(await answered(await signing)).toEqual(accountBanned)
    },
    ARGON2_RUNS_MS,
  )
})

describe('authHandler, a passkey sign-in the directory cannot keep', () => {
  it.each([
    { what: 'the count of its signatures moved on', failing: isPasskeyUpdate },
    { what: 'its session written', failing: isSessionInsert },
  ])(
    'answers 500 internal to a verified passkey whose sign-in the directory could not keep, $what, signing nothing in',
    async ({ failing }) => {
      const refusing = { now: false }
      const mounted = await mountedOnRealAuth({
        directory: (local) =>
          interceptQueries(local, (text) => {
            if (refusing.now && failing(text)) {
              throw new Error('the directory refused the write')
            }
          }),
      })
      const { ann, held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)

      refusing.now = true
      expect(
        await answered(await mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.4.1')),
      ).toEqual({ status: 500, body: { code: 'internal' } })
      refusing.now = false
      expect(await devicesOf(mounted, ann.identity)).toEqual(['laptop'])
      expect(mounted.logs.map(({ code }) => code)).toEqual(['auth:STORAGE_FAILED'])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 500 internal to a verified passkey whose account the directory could not read once its session was written, that session ended',
    async () => {
      const refusing = { now: false, written: false }
      const mounted = await mountedOnRealAuth({
        directory: (local) =>
          interceptQueries(local, (text) => {
            if (!refusing.now) {
              return
            }

            // Better Auth wrote the session waiting for its admission, then reads the account to
            // answer with it: that read fails.
            if (isSessionInsert(text)) {
              refusing.written = true
            } else if (
              refusing.written &&
              text.startsWith('SELECT') &&
              text.includes('FROM `identity`')
            ) {
              throw new Error('the directory failed a read')
            }
          }),
      })
      const { ann, held } = await annWithPasskey(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)

      refusing.now = true
      expect(
        await answered(await mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.4.2')),
      ).toEqual({ status: 500, body: { code: 'internal' } })
      refusing.now = false
      expect(refusing.written).toBe(true)

      // The session the request wrote was never handed out, and is ended, not left waiting.
      const desk = (await sessionStates(mounted.local, ann.identity)).filter(
        (row) => row.device === 'desk',
      )

      expect(desk).toHaveLength(1)
      expect(desk.map((row) => row.ended_at instanceof Date)).toEqual([true])
      expect(await devicesOf(mounted, ann.identity)).toEqual(['laptop'])
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a passkey sign-in and a removal of its passkey in the account's turn", () => {
  it(
    'answers 401 passkey-unknown to a sign-in that waited for the turn in which its passkey was removed',
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held, id } = await annWithPasskey(mounted)
      const passkeys = passkeysOf(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const asked = turnsAsked(mounted.turns)
      const release = await holdTurn(mounted.turns, ann.identity)
      const removing = passkeys.remove(ann.on('laptop'), id)

      await turnsReach(asked, ann.identity, 2)

      const signing = mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.2.1')

      await turnsReach(asked, ann.identity, 3)
      release()

      expect((await removing).status).toBe(204)
      expect(await answered(await signing)).toEqual(passkeyUnknown)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'signs in with a passkey whose turn came before its removal, which waits for the whole turn, its admission included, and then ends no session',
    async () => {
      const queries = heldQueries()
      const mounted = await mountedOnRealAuth({ directory: queries.directory })
      const { ann, held, id } = await annWithPasskey(mounted)
      const passkeys = passkeysOf(mounted)
      const assertion = await assertionOf(mounted, 'desk', held)
      const started = turnsStarted(mounted.turns)
      const admission = queries.hold(isAdmission)
      const signing = mounted.route(passkeySignInRequest(assertion, 'desk'), '198.18.2.2')

      // Better Auth verified the passkey and wrote the session, and the gateway is admitting it, the
      // last step of the sign-in's turn; the removal asks for the turn meanwhile.
      await vi.waitFor(() => expect(admission.paused()).toBe(true), ARGON2_WAIT)

      const removing = passkeys.remove(ann.on('laptop'), id)

      await vi.waitFor(() => expect(started.asked(ann.identity)).toBe(2), ARGON2_WAIT)
      // The removal's turn has not started: the sign-in's runs on through its admission.
      expect(started.started(ann.identity)).toBe(1)
      admission.release()

      const { status, body } = await answered(await signing)

      expect(status).toBe(200)
      expect((await removing).status).toBe(204)
      expect(started.started(ann.identity)).toBe(2)
      expect((await mounted.sessions.read(tokenOf(body))).kind).toBe('session')
      expect(await passkeys.listed(ann.on('laptop'))).toEqual([])
    },
    ARGON2_RUNS_MS,
  )
})

describe("authHandler, a passkey sign-in at the account's limit of devices", () => {
  it(
    "answers 409 device-limit naming the account it asks about, nothing signed in and the email's failed sign-ins forgotten, and signs in once confirmed for that account, the device seen least recently signed out",
    async () => {
      const mounted = await mountedOnRealAuth()
      const { ann, held } = await annWithPasskey(mounted, AT_THE_LIMIT)

      // Every device but c is seen after the sign-ins, c the least recently: c is the one to go.
      await seenInTurn(
        mounted,
        ann,
        AT_THE_LIMIT.filter((device) => device !== 'c'),
      )
      await wrongPasswords(mounted, FAILED_SIGN_INS.limit - 1, '198.18.3.1')

      expect(await passkeySignIn(mounted, PAST_THE_LIMIT, held)).toEqual({
        status: 409,
        body: { code: 'device-limit', consentFor: ann.identity },
      })
      expect(await endedOf(mounted, ann.identity)).toEqual([])
      // The passkey was the sign-in's last step: as many wrong passwords as are allowed are each judged again.
      await wrongPasswords(mounted, FAILED_SIGN_INS.limit, '198.18.3.2')

      const confirmed = await passkeySignIn(mounted, PAST_THE_LIMIT, held, {
        signOutOldestFor: ann.identity,
      })

      expect(confirmed.status).toBe(200)
      expect((await mounted.sessions.read(tokenOf(confirmed.body))).kind).toBe('session')
      expect(await endedOf(mounted, ann.identity)).toEqual([['c', 'device-limit']])
      // Its socket, and no other, is closed for the limit.
      expect(mounted.closes.filter(([, , code]) => code === CLOSE.deviceLimit)).toEqual([
        [ann.identity, 'c', CLOSE.deviceLimit],
      ])
      expect(ann.sockets.get('c')?.ended).toEqual([CLOSE.deviceLimit])
    },
    ARGON2_RUNS_MS * 2,
  )

  it(
    "answers 409 naming the other account to a sign-in confirmed for one account whose passkey is another's at its limit, signing nobody out",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const { ann: bob, held } = await annWithPasskey(mounted, AT_THE_LIMIT, BOB)

      expect(
        await passkeySignIn(mounted, PAST_THE_LIMIT, held, { signOutOldestFor: ann.identity }),
      ).toEqual({
        status: 409,
        body: { code: 'device-limit', consentFor: bob.identity },
      })
      expect(await endedOf(mounted, bob.identity)).toEqual([])
      expect(mounted.closes.filter(([, , code]) => code === CLOSE.deviceLimit)).toEqual([])
    },
    ARGON2_RUNS_MS * 2,
  )
})
