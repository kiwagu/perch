import { base32 } from '@better-auth/utils/base32'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type IdentityId, idSchemas, two_factorIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import { KeyedTurns } from '../keyed-turns'
import { RequestLimits } from '../limits/request-limits'

import {
  AUTH_SECRET,
  accountServicesOf,
  deviceHeaders,
  openAuth,
  signUpOn,
} from './__fixtures__/auth-instance'
import {
  codeOf,
  keyOf,
  passwordStepRequest,
  secondStep,
  stateOf,
  wrongCodeOf,
} from './__fixtures__/second-factor'
import twoFactorChallengeRowsStatement from './__fixtures__/two-factor-challenge-rows.surql'
import { AuthSessions } from './auth-sessions'
import { deviceRoutes } from './device.routes'
import { DeviceSessions } from './device-sessions'
import { accountChoicePolicy } from './second-factor-policy.account-choice'
import type { SecondFactorDecision, SecondFactorPolicy } from './second-factor-policy.port'
import { twoFactorRoutes } from './two-factor.routes'
import { TwoFactorRows } from './two-factor-rows'

const PASSWORD = 'Pass-word-1'

const ANN = 'ann@example.test'

const LAPTOP = 'laptop'

/** What a successful enable answers: the key and its URI, the ten backup codes, the enrolment. */
const enabled = z.strictObject({
  key: z.string().min(1),
  uri: z.string().startsWith('otpauth://totp/'),
  backupCodes: z.array(z.string().min(1)).length(10),
  enrolment: idSchemas.two_factor.schema,
})

const renewed = z.strictObject({ backupCodes: z.array(z.string().min(1)).length(10) })

const noContent = { status: 204, body: undefined }

const unauthorized = { status: 401, body: { code: 'unauthorized' } }

const badRequest = { status: 400, body: { code: 'bad-request' } }

const changed = { status: 409, body: { code: 'two-factor-changed' } }

const invalidCredentials = { status: 400, body: { code: 'invalid-credentials' } }

const invalidCode = { status: 400, body: { code: 'invalid-code' } }

const failed = { status: 403, body: { code: 'failed' } }

/** Closes what a test opened. */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()

  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

/** An identity signed in on a device: its id, its raw session token and the device. */
interface Caller {
  readonly identity: IdentityId
  readonly token: string
  readonly device: string
}

interface Ask {
  /** Sends the caller's token as `Authorization: Bearer <token>`, and its device. */
  readonly as?: Caller
  /** The `X-Perch-Device` header instead of the caller's device; `null` leaves it out. */
  readonly device?: string | null
  /** The JSON body; a string is sent as it is, for a body that is not JSON. */
  readonly body?: unknown
}

/** The client address each request comes from: one of its own, so no address limit holds one back. */
let sent = 0

function request(method: string, path: string, ask: Ask = {}): Request {
  const headers = new Headers()
  const device = ask.device === undefined ? ask.as?.device : ask.device

  if (ask.as) {
    headers.set('Authorization', `Bearer ${ask.as.token}`)
  }

  if (device !== undefined && device !== null) {
    headers.set('X-Perch-Device', device)
  }

  if (ask.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  return new Request(`http://gateway.test${path}`, {
    method,
    headers,
    ...(ask.body === undefined
      ? {}
      : { body: typeof ask.body === 'string' ? ask.body : JSON.stringify(ask.body) }),
  })
}

async function answer(response: Response | undefined): Promise<{ status: number; body: unknown }> {
  if (!response) {
    return expect.unreachable('the route answered nothing')
  }

  const text = await response.text()
  const body: unknown = text === '' ? undefined : (JSON.parse(text) as unknown)

  return { status: response.status, body }
}

/** A policy that decides `decision` for every account. */
const deciding = (decision: SecondFactorDecision): SecondFactorPolicy => ({
  decide: () => Promise.resolve(decision),
})

/**
 * The routes over a Better Auth instance on an embedded directory, with Ann signed up and
 * verified on her laptop; a stub policy may stand in for the account's own choice.
 */
async function harness(policy: SecondFactorPolicy = accountChoicePolicy) {
  const opened = await openAuth()

  cleanups.push(opened.close)

  const { auth, local, clock } = opened
  const sessions = new AuthSessions({ auth, directory: local, clock, secret: AUTH_SECRET })
  const turns = new KeyedTurns<string>()
  const rows = new TwoFactorRows(local)
  const limits = new RequestLimits({ clock })
  const routes = twoFactorRoutes({
    auth,
    sessions,
    passwords: accountServicesOf(opened).passwords,
    limits,
    accounts: turns,
    rows,
    policy,
  })
  const devices = deviceRoutes(
    sessions,
    new DeviceSessions({ directory: local, clock }),
    { close: () => Promise.resolve() },
    { onFailure: () => undefined, clock },
  )
  const { token, user } = await signUpOn(auth, ANN, deviceHeaders(LAPTOP))
  const ann: Caller = {
    identity: idSchemas.identity.schema.parse(user.id),
    token,
    device: LAPTOP,
  }

  const ask = async (method: string, path: string, options: Ask = {}) =>
    answer(await routes(request(method, path, options), `198.18.0.${++sent % 250}`))

  /** The status `GET /devices` answers the caller's bearer: 200 while its session lives. */
  const devicesStatus = async (caller: Caller = ann) =>
    (await devices(request('GET', '/devices', { as: caller }), '198.18.1.1'))?.status

  const enable = async (password = PASSWORD, caller: Caller = ann) => {
    const { status, body } = await ask('POST', '/two-factor/enable', {
      as: caller,
      body: { password },
    })

    expect(status).toBe(200)

    return enabled.parse(body)
  }

  const confirm = (enrolment: string, code: string, caller: Caller = ann) =>
    ask('POST', '/two-factor/confirm', { as: caller, body: { code, enrolment } })

  const renew = (password = PASSWORD, caller: Caller = ann) =>
    ask('POST', '/two-factor/renew-codes', { as: caller, body: { password } })

  const disable = (password = PASSWORD, caller: Caller = ann) =>
    ask('POST', '/two-factor/disable', { as: caller, body: { password } })

  const read = async (caller: Caller = ann) => {
    const { status, body } = await ask('GET', '/two-factor', { as: caller })

    expect(status).toBe(200)

    return z.strictObject({ enabled: z.boolean() }).parse(body).enabled
  }

  /** The factor enabled and confirmed with a code of its key. */
  const turnedOn = async () => {
    const started = await enable()

    expect(await confirm(started.enrolment, await codeOf(keyOf(started.uri)))).toEqual(noContent)

    return started
  }

  return {
    opened,
    routes,
    turns,
    ann,
    ask,
    devicesStatus,
    enable,
    confirm,
    renew,
    disable,
    read,
    turnedOn,
    rows,
    limits,
    state: (caller: Caller = ann) => stateOf(opened, caller.identity),
  }
}

describe('twoFactorRoutes', () => {
  it('answers a key, its URI, ten backup codes and an enrolment at enable, and leaves the factor off', async () => {
    const { ann, enable, read, state, devicesStatus } = await harness()
    const started = await enable()
    const uri = new URL(started.uri)

    // The key is the base32 text of the secret the URI carries, which Better Auth issued as `Perch`.
    expect(started.key).toBe(uri.searchParams.get('secret'))
    expect(uri.searchParams.get('issuer')).toBe('Perch')
    expect(new TextDecoder().decode(base32.decode(started.key))).toBe(keyOf(started.uri))
    expect(new Set(started.backupCodes).size).toBe(10)

    const kept = await state()

    expect(kept.enabled ?? false).toBe(false)
    expect(kept.rows.map((row) => [row.id, row.verified])).toEqual([[started.enrolment, false]])
    expect(await read()).toBe(false)
    // The caller's session is the one it was: nothing rotated it.
    expect(await devicesStatus(ann)).toBe(200)
  }, 30_000)

  it('turns the factor on at a code of the key, the same bearer still reading its devices', async () => {
    const { ann, enable, confirm, read, state, devicesStatus } = await harness()
    const started = await enable()

    expect(await confirm(started.enrolment, await codeOf(keyOf(started.uri)))).toEqual(noContent)
    expect(await read()).toBe(true)
    expect((await state()).rows.map((row) => row.verified)).toEqual([true])
    expect(await devicesStatus(ann)).toBe(200)
  }, 30_000)

  it('refuses a code of another key with 400 invalid-code and leaves the factor off', async () => {
    const { enable, confirm, read, state } = await harness()
    const started = await enable()

    expect(await confirm(started.enrolment, await wrongCodeOf(keyOf(started.uri)))).toEqual(
      invalidCode,
    )
    expect(await read()).toBe(false)
    expect((await state()).rows.map((row) => row.verified)).toEqual([false])
  }, 30_000)

  it('answers 409 two-factor-changed to a confirmation of an enrolment a later enable replaced, whatever its code', async () => {
    const { enable, confirm, read, state } = await harness()
    const first = await enable()
    const second = await enable()

    expect(second.enrolment).not.toBe(first.enrolment)
    expect(second.key).not.toBe(first.key)
    expect(await confirm(first.enrolment, await codeOf(keyOf(first.uri)))).toEqual(changed)
    expect(await confirm(first.enrolment, await wrongCodeOf(keyOf(first.uri)))).toEqual(changed)
    expect(await read()).toBe(false)
    // The key kept is the second one, still waiting for its code.
    expect((await state()).rows.map((row) => [row.id, row.verified])).toEqual([
      [second.enrolment, false],
    ])
    expect(await confirm(second.enrolment, await codeOf(keyOf(second.uri)))).toEqual(noContent)
  }, 30_000)

  it('answers 409 to a confirmation of an enrolment no row holds, and to an enrolment of a malformed shape 400', async () => {
    const { ann, ask, confirm, read } = await harness()

    expect(await confirm(two_factorIdFactory.create(), '123456')).toEqual(changed)
    expect(
      await ask('POST', '/two-factor/confirm', {
        as: ann,
        body: { code: '123456', enrolment: 'not-an-enrolment' },
      }),
    ).toEqual(badRequest)
    expect(await read()).toBe(false)
  }, 30_000)

  it('answers 409 to an enable and to a confirmation while the factor is on, changing nothing', async () => {
    const { confirm, ask, ann, read, state, turnedOn } = await harness()
    const started = await turnedOn()
    const before = await state()

    expect(
      await ask('POST', '/two-factor/enable', { as: ann, body: { password: PASSWORD } }),
    ).toEqual(changed)
    expect(await confirm(started.enrolment, await codeOf(keyOf(started.uri)))).toEqual(changed)
    expect(await state()).toEqual(before)
    expect(await read()).toBe(true)
  }, 30_000)

  it('answers 409 to a renewal while the factor is off, a key waiting for its code included', async () => {
    const { enable, renew } = await harness()

    expect(await renew()).toEqual(changed)

    await enable()

    expect(await renew()).toEqual(changed)
  }, 30_000)

  it('renews the ten backup codes while the factor is on: the earlier ones refused, the new ones taken, the bearer signed in', async () => {
    const { opened, ann, turnedOn, renew, devicesStatus } = await harness()
    const turned = await turnedOn()
    const { status, body } = await renew()

    expect(status).toBe(200)

    const { backupCodes } = renewed.parse(body)

    expect(new Set([...backupCodes, ...turned.backupCodes]).size).toBe(20)
    expect(await devicesStatus(ann)).toBe(200)

    // A code of the earlier set fails at Better Auth's own verification, one of the new set passes.
    const old = await secondStep(
      opened,
      'phone',
      '/two-factor/verify-backup-code',
      turned.backupCodes[0] ?? '',
    )

    expect(old.status).toBe(401)
    expect(z.object({ code: z.string() }).parse(await old.json()).code).toBe('INVALID_BACKUP_CODE')
    expect(
      (await secondStep(opened, 'desk', '/two-factor/verify-backup-code', backupCodes[0] ?? ''))
        .status,
    ).toBe(200)
  }, 60_000)

  it('turns the factor off with the password, twice alike, its key unusable and its challenges ended, the bearer signed in', async () => {
    const { opened, ann, disable, read, state, turnedOn, confirm, devicesStatus } = await harness()
    const started = await turnedOn()

    // A sign-in's password step met the factor: its challenge and its attempts row are pending.
    const challenged = await opened.auth.handler(passwordStepRequest(ANN, PASSWORD, 'phone'))

    expect(await challenged.json()).toEqual({ twoFactorRedirect: true, twoFactorMethods: ['totp'] })
    expect(
      (await opened.local.db.query<[string[]]>(twoFactorChallengeRowsStatement))[0],
    ).toHaveLength(2)

    expect(await disable()).toEqual(noContent)
    expect(await read()).toBe(false)
    expect((await state()).rows).toEqual([])
    expect((await opened.local.db.query<[string[]]>(twoFactorChallengeRowsStatement))[0]).toEqual(
      [],
    )
    expect(await devicesStatus(ann)).toBe(200)
    // Off already: the same answer, nothing to undo.
    expect(await disable()).toEqual(noContent)
    expect(await devicesStatus(ann)).toBe(200)
    // The key of an enrolment that is gone confirms nothing.
    expect(await confirm(started.enrolment, await codeOf(keyOf(started.uri)))).toEqual(changed)
  }, 60_000)

  it("counts a wrong password at enable, disable and renewal among the email's failed sign-ins: the eleventh answers 429", async () => {
    const { ann, ask } = await harness()
    const paths = [
      ...Array<string>(4).fill('/two-factor/enable'),
      ...Array<string>(3).fill('/two-factor/disable'),
      ...Array<string>(3).fill('/two-factor/renew-codes'),
    ]

    for (const path of paths) {
      expect(await ask('POST', path, { as: ann, body: { password: 'Wrong-pass-1' } })).toEqual(
        invalidCredentials,
      )
    }

    const eleventh = await ask('POST', '/two-factor/enable', {
      as: ann,
      body: { password: PASSWORD },
    })

    expect(eleventh).toEqual({ status: 429, body: { code: 'rate-limited' } })
  }, 60_000)

  it('refuses an enable the policy does not allow, and a disable it requires, with 403 failed, changing nothing', async () => {
    const refusing = await harness(deciding({ allowed: false, required: false }))

    expect(
      await refusing.ask('POST', '/two-factor/enable', {
        as: refusing.ann,
        body: { password: PASSWORD },
      }),
    ).toEqual(failed)
    expect((await refusing.state()).rows).toEqual([])

    const requiring = await harness(deciding({ allowed: true, required: true }))
    // The policy lets it turn on; it may not turn it off again.
    const started = await requiring.turnedOn()

    expect(await requiring.disable()).toEqual(failed)
    expect(await requiring.read()).toBe(true)
    expect((await requiring.state()).rows.map((row) => row.id)).toEqual([started.enrolment])
  }, 60_000)

  it.each([
    ['renews the backup codes', 'renew-codes', 200],
    ['asks for a new key while the factor is on, which answers 409', 'enable', 409],
    ['turns the factor off', 'disable', 204],
  ] as const)(
    "forgets none of the email's failed sign-ins when a right password %s",
    async (_, name, status) => {
      const { ann, ask, limits, turnedOn } = await harness()

      await turnedOn()

      // Nine failed sign-ins of the account: one short of the ten the limit allows.
      for (let failures = 0; failures < 9; failures += 1) {
        const attempt = limits.signInAttempt(ANN)

        if (!attempt.allowed) {
          expect.unreachable('nine failures are within the limit')
        }

        attempt.settle('failed')
      }

      expect(
        (await ask('POST', `/two-factor/${name}`, { as: ann, body: { password: PASSWORD } }))
          .status,
      ).toBe(status)
      // The right password forgot nothing: the next failure is the tenth, and the limit holds.
      expect(
        await ask('POST', '/two-factor/disable', { as: ann, body: { password: 'Wrong-pass-1' } }),
      ).toEqual(invalidCredentials)
      expect(
        await ask('POST', '/two-factor/disable', { as: ann, body: { password: PASSWORD } }),
      ).toEqual({ status: 429, body: { code: 'rate-limited' } })
    },
    60_000,
  )

  it("runs each change in the account's turn, and a read in none", async () => {
    const { ann, turns, enable, confirm, renew, disable, read } = await harness()
    const run = vi.spyOn(turns, 'run')
    const started = await enable()

    await confirm(started.enrolment, await codeOf(keyOf(started.uri)))
    await renew()
    await disable()
    await read()

    expect(run.mock.calls.map(([key]) => key)).toEqual([
      ann.identity,
      ann.identity,
      ann.identity,
      ann.identity,
    ])
  }, 60_000)

  it('reads the account in its turn: a confirmation and a renewal that waited for a turn that turned the factor off answer 409', async () => {
    const { ann, turns, rows, enable, confirm, renew, turnedOn, state } = await harness()
    const run = vi.spyOn(turns, 'run')
    /** Holds the account's turn, asks, commits a disable beside it, releases the turn: the answer. */
    const waiting = async (asked: () => Promise<{ status: number; body: unknown }>) => {
      const held = Promise.withResolvers<void>()

      run.mockClear()

      const turn = turns.run(ann.identity, () => held.promise)
      const answering = asked()

      // The request is queued behind the held turn once it has asked for its own.
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
      expect((await rows.disable(ann.identity)).isOk()).toBe(true)
      held.resolve()
      await turn

      return answering
    }
    const started = await enable()

    expect(
      await waiting(async () => confirm(started.enrolment, await codeOf(keyOf(started.uri)))),
    ).toEqual(changed)
    expect((await state()).rows).toEqual([])

    await turnedOn()
    expect(await waiting(() => renew())).toEqual(changed)
    expect((await state()).rows).toEqual([])
  }, 60_000)

  it('serves its paths by their one method to a caller whose session lives on the device it names', async () => {
    const { ann, ask, routes, read } = await harness()
    const paths = ['enable', 'confirm', 'disable', 'renew-codes'].map(
      (name) => `/two-factor/${name}`,
    )

    for (const path of paths) {
      expect(await ask('POST', path, { device: LAPTOP, body: { password: PASSWORD } })).toEqual(
        unauthorized,
      )
      expect(await ask('POST', path, { as: { ...ann, token: 'not-a-token' }, body: {} })).toEqual(
        unauthorized,
      )
      // Another device than the session's: refused as a token carried to another device is.
      expect(await ask('POST', path, { as: ann, device: 'phone', body: {} })).toEqual(unauthorized)
      // No device, then a body that is not JSON, then none.
      expect(await ask('POST', path, { as: ann, device: null, body: {} })).toEqual(badRequest)
      expect(await ask('POST', path, { as: ann, body: '{' })).toEqual(badRequest)
      expect(await ask('POST', path, { as: ann })).toEqual(badRequest)

      const wrong = await routes(request('GET', path, { as: ann }), '198.18.2.2')

      expect(wrong?.status).toBe(405)
      expect(wrong?.headers.get('Allow')).toBe('POST')
    }

    const post = await routes(request('POST', '/two-factor', { as: ann }), '198.18.2.2')

    expect(post?.status).toBe(405)
    expect(post?.headers.get('Allow')).toBe('GET')
    expect(await ask('GET', '/two-factor', { device: LAPTOP })).toEqual(unauthorized)
    expect(await read()).toBe(false)
    expect(await routes(request('GET', '/devices', { as: ann }), '198.18.2.2')).toBeUndefined()
  }, 60_000)

  it("refuses a code outside the second factor's lengths before anything is looked at", async () => {
    const { ann, ask, enable, confirm } = await harness()
    const started = await enable()

    for (const length of [5, 12]) {
      expect(await confirm(started.enrolment, 'a'.repeat(length))).toEqual(badRequest)
    }

    // The bounds themselves reach the code check: a six-digit code of another key, and eleven
    // zeros, which no six-digit code of the key is.
    expect(await confirm(started.enrolment, await wrongCodeOf(keyOf(started.uri)))).toEqual(
      invalidCode,
    )
    expect(await confirm(started.enrolment, '0'.repeat(11))).toEqual(invalidCode)
    expect(
      await ask('POST', '/two-factor/confirm', { as: ann, body: { enrolment: started.enrolment } }),
    ).toEqual(badRequest)
  }, 60_000)
})
