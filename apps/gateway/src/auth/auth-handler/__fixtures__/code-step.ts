/**
 * The set-ups of the specs of a sign-in's code step: an account whose second factor is on, the
 * challenge its password step answers, the code step as the web sends it, the rows Better Auth
 * keeps for pending challenges, and the routes of the second factor and of the devices over the
 * very services, limits and turns the mount answers with.
 */

import { expect, vi } from 'vitest'

import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { secondFactorOn } from '../../__fixtures__/second-factor'
import challengeAgeStatement from '../../__fixtures__/two-factor-challenge-age.surql'
import challengeRowsStatement from '../../__fixtures__/two-factor-challenge-rows.surql'
import { deviceRoutes } from '../../device.routes'
import { DeviceSessions } from '../../device-sessions'
import { accountChoicePolicy } from '../../second-factor-policy.account-choice'
import { twoFactorRoutes } from '../../two-factor.routes'
import { TwoFactorRows } from '../../two-factor-rows'

import {
  ANN,
  ARGON2_WAIT,
  type mountedOnRealAuth,
  PASSWORD,
  postTo,
  type Sender,
  type SignedInAccount,
  signedInOn,
  signInRequest,
} from './mount'

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The path of a sign-in's code step. */
export const CONFIRM_PATH = '/auth/confirm-sign-in'

/** A status and the JSON body of an answer, none for an empty one. */
export async function answered(
  response: Response | undefined,
): Promise<{ status: number; body: unknown }> {
  if (response === undefined) {
    return expect.unreachable('the route answered nothing')
  }

  const text = await response.text()

  return { status: response.status, body: text === '' ? undefined : (JSON.parse(text) as unknown) }
}

/** The challenge a password step answered: Better Auth's own, which no test can know beforehand. */
export const challengeOf = (body: unknown): string =>
  z.object({ secondFactor: z.object({ challenge: z.string().min(1) }) }).parse(body).secondFactor
    .challenge

/** The session token a sign-in answered with: a raw token, which no test can know beforehand. */
export const tokenOf = (body: unknown): string =>
  z.object({ token: z.string().min(1) }).parse(body).token

/** The identifiers of every row of a pending two-factor challenge in the directory. */
export async function challengeRows(mounted: Mounted): Promise<unknown[]> {
  const [rows] = await mounted.local.db.query<[unknown[]]>(challengeRowsStatement)

  return rows
}

/**
 * Sets the expiry of every pending two-factor challenge to `at`: Better Auth judges a challenge's
 * age by the system clock, which the gateway's clock does not move, so its rows' expiry is moved.
 */
export async function expireChallengesAt(mounted: Mounted, at: Date): Promise<void> {
  await mounted.local.db.query(challengeAgeStatement, { at })
}

/** Ages every pending two-factor challenge past its ten minutes: its rows expired a minute ago. */
export async function ageChallenges(mounted: Mounted): Promise<void> {
  await expireChallengesAt(mounted, new Date(Date.now() - 60_000))
}

/** An account signed in on devices, its second factor on: its key, its backup codes. */
export interface FactorAccount extends SignedInAccount {
  /** The key's secret, as an authenticator app keeps it. */
  readonly secret: string
  /** The ten backup codes Better Auth showed once. */
  readonly backupCodes: readonly string[]
}

/**
 * Signs `email` up, verifies it on the first of `devices` and signs it in on the others, then turns
 * its second factor on from the first one, which replaces that device's session: the account
 * carries the new token.
 */
export async function withSecondFactor(
  mounted: Mounted,
  devices: readonly [string, ...string[]] = ['laptop', 'phone'],
  email = ANN,
): Promise<FactorAccount> {
  const account = await signedInOn(mounted, email, devices)
  const [first] = devices
  const factor = await secondFactorOn(
    mounted.auth,
    first,
    account.tokens.get(first) ?? expect.unreachable('a session of the first device'),
  )
  const tokens = new Map(account.tokens)

  tokens.set(first, factor.token)

  return {
    ...account,
    tokens,
    on: (device) => {
      const token = tokens.get(device)

      return token === undefined ? { device } : { device, token }
    },
    secret: factor.secret,
    backupCodes: factor.backupCodes,
  }
}

/** The password step of `email` from `device` with its right password: the challenge it answered. */
export async function passwordStep(
  mounted: Mounted,
  device: string,
  from: string,
  email = ANN,
): Promise<string> {
  const { status, body } = await answered(
    await mounted.route(signInRequest(email, PASSWORD, device), from),
  )

  expect(status).toBe(200)

  return challengeOf(body)
}

/** What a code step names beside its challenge and its code. */
export interface CodeStepOptions {
  /** The email typed at the password step; Ann's unless named. */
  readonly email?: string
  readonly signOutOldest?: boolean
}

/** The code step of `challenge` with `code` from `device`, as the web sends it from the front. */
export function codeStep(
  challenge: string,
  code: string,
  device: string,
  options: CodeStepOptions = {},
): Request {
  const { email = ANN, signOutOldest } = options

  return postTo(
    CONFIRM_PATH,
    signOutOldest === undefined
      ? { challenge, email, code }
      : { challenge, email, code, signOutOldest },
    { device },
  )
}

/** Wrong passwords of `email` from `device`, `count` of them, each refused 401. */
export async function wrongPasswords(
  mounted: Mounted,
  count: number,
  from: string,
  email = ANN,
): Promise<void> {
  for (let failed = 0; failed < count; failed++) {
    expect(
      (await mounted.route(signInRequest(email, 'Wrong-pass-word-9', 'probe'), from))?.status,
    ).toBe(401)
  }
}

/**
 * The routes of the second factor's settings and of the devices over the mount's own sessions,
 * passwords, limits and turns, so a change of the factor waits for a code step's turn and spends
 * the same email's failed sign-ins, and a sign-in's token is read as the devices page reads it.
 */
export function settingsOf(mounted: Mounted) {
  const twoFactor = twoFactorRoutes({
    auth: mounted.auth,
    sessions: mounted.sessions,
    passwords: mounted.passwords,
    limits: mounted.deps.limits,
    accounts: mounted.turns,
    rows: new TwoFactorRows(mounted.local),
    policy: accountChoicePolicy,
  })
  const devices = deviceRoutes(
    mounted.sessions,
    new DeviceSessions({ directory: mounted.local, clock: mounted.clock }),
    { close: () => Promise.resolve() },
    { onFailure: () => undefined, clock: mounted.clock },
  )
  let sent = 0
  /** A request of `sender` to the second factor's `path`, from an address of its own. */
  const post = async (path: string, sender: Sender, body: unknown) =>
    answered(await twoFactor(postTo(path, body, sender), `198.18.7.${++sent % 250}`))

  return {
    /** Turns the factor off with the account's password: 204 once it is off. */
    disable: (sender: Sender) => post('/two-factor/disable', sender, { password: PASSWORD }),
    /** Starts a new key, unconfirmed: its URI and its backup codes. */
    enable: async (sender: Sender) => {
      const { status, body } = await post('/two-factor/enable', sender, { password: PASSWORD })

      expect(status).toBe(200)

      return z.object({ uri: z.string(), backupCodes: z.array(z.string()) }).parse(body)
    },
    /** Renews the backup codes: the ten new ones. */
    renew: (sender: Sender) => post('/two-factor/renew-codes', sender, { password: PASSWORD }),
    /** The status `GET /devices` answers `token` from `device`: 200 while its session lives. */
    devicesStatus: async (device: string, token: string) => {
      const headers = new Headers({ 'X-Perch-Device': device, authorization: `Bearer ${token}` })

      return (await devices(new Request('http://gateway.test/devices', { headers }), '198.18.8.1'))
        ?.status
    },
  }
}

/** Waits until `asked(key)` counts `count` turns asked for `key`. */
export async function turnsReach(
  asked: (key: string) => number,
  key: IdentityId,
  count: number,
): Promise<void> {
  await vi.waitFor(() => expect(asked(key)).toBe(count), ARGON2_WAIT)
}
