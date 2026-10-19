import { readFileSync } from 'node:fs'

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { createAuth, type DataError, dataError, type LocalDb } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import { device_sessionIdFactory, identityIdFactory } from '@workspace/ids'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import liveGrantsStatement from './__fixtures__/grants-live.surql'
import { DeviceSessions, type DeviceTouch } from './device-sessions'
import {
  type AuthenticatedDevice,
  grantIdOf,
  IdentitySessions,
  type RenewalGate,
} from './identity-sessions'
import { issuedAtOf } from './token-claims'

const ann = { email: 'ann@example.test', password: 'pass-word-1' }

/** The device Ann signs in on. */
const laptop = { id: 'device-laptop', label: 'Firefox on Linux' }

/** A gate that lets every renewal through. */
const anyRenewal: RenewalGate = () => true

/** The access method identities sign in through, and the scope its tokens are issued for. */
const identityAccess = { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }

/** A second access method of the directory database, whose tokens the identity access never issued. */
const elsewhereAccess = readFileSync(
  new URL('./__fixtures__/identity-elsewhere-access.surql', import.meta.url),
  'utf8',
)

const opened: LocalDb[] = []

/** Failures reported that no test expected. */
const reportedFailures: DataError[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.close()))

  expect(reportedFailures.splice(0)).toEqual([])
})

async function testDb(schema = readSchema('directory')): Promise<LocalDb> {
  const local = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema })
  )._unsafeUnwrap()

  opened.push(local)

  return local
}

/** The parts of the device sessions identity sessions use. */
type SessionDevices = Pick<DeviceSessions, 'touch' | 'revokeGrant'>

interface RecordingOptions {
  /** Refuses the touch when it says so. */
  readonly refuse?: () => boolean
  /** Fails each revoke of a grant. */
  readonly failRevokes?: boolean
}

/**
 * The device sessions as identity sessions see them: each touch is recorded and answered with
 * its row and the grant the device's row held before (none on its first touch), or refused when
 * `refuse` says so; each revoke of a grant is recorded.
 */
function recordingDevices(options: RecordingOptions = {}) {
  const touched: DeviceTouch[] = []
  const revoked: Array<{ readonly identity: string; readonly grant: string }> = []
  const grants = new Map<string, string>()
  const devices: SessionDevices = {
    touch: (input) => {
      touched.push(input)

      if (options.refuse?.()) {
        return errAsync(dataError('data:WRITE_FAILED', 'the directory refused the device'))
      }

      const key = `${input.identity}#${input.device}`
      const previous = grants.get(key)

      grants.set(key, input.grant)

      return okAsync({
        row: {
          id: device_sessionIdFactory.create(),
          identity: input.identity,
          device: input.device,
          label: input.label,
          grant: input.grant,
          createdAt: new Date(0),
          lastSeenAt: new Date(0),
          startedAt: input.startedAt,
        },
        ...(previous === undefined ? {} : { previous }),
      })
    },
    revokeGrant: (input) => {
      revoked.push(input)

      return options.failRevokes
        ? errAsync(dataError('data:WRITE_FAILED', 'the directory refused the revoke'))
        : okAsync(undefined)
    },
  }

  return { touched, revoked, devices }
}

/** Sessions over `local`, opening auth sessions as the composition root does. */
function sessionsOver(
  local: LocalDb,
  options: {
    readonly onFailure?: (error: DataError) => void
    readonly devices?: SessionDevices
    readonly clock?: ManualClock
  } = {},
): IdentitySessions {
  return new IdentitySessions({
    openAuth: () => createAuth(local, identityAccess),
    scope: identityAccess,
    onFailure: options.onFailure ?? ((error) => reportedFailures.push(error)),
    devices: options.devices ?? recordingDevices().devices,
    clock: options.clock ?? manualClock(),
  })
}

async function testSessions(): Promise<IdentitySessions> {
  return sessionsOver(await testDb())
}

/** Makes every driver session opened on `local` from now on fail to open, as an outage would. */
function failOpening(local: LocalDb): void {
  local.db.newSession = () => Promise.reject(new Error('the database cannot be reached'))
}

/** Sessions over a database that counts the driver sessions opened and closed on it. */
async function countingSessions() {
  const local = await testDb()
  const newSession = local.db.newSession.bind(local.db)
  let opened = 0
  let closed = 0

  local.db.newSession = async () => {
    const session = await newSession()
    const closeSession = session.closeSession.bind(session)

    opened += 1
    session.closeSession = async () => {
      closed += 1
      await closeSession()
    }

    return session
  }

  return {
    sessions: sessionsOver(local),
    opened: () => opened,
    closed: () => closed,
  }
}

/** Makes closing every driver session opened on `local` from now on fail once it has closed. */
function failClosing(local: LocalDb): void {
  const newSession = local.db.newSession.bind(local.db)

  local.db.newSession = async () => {
    const session = await newSession()
    const closeSession = session.closeSession.bind(session)

    session.closeSession = async () => {
      await closeSession()

      throw new Error('the connection to the database dropped')
    }

    return session
  }
}

describe('IdentitySessions', () => {
  it('signs an identity up and in, and the tokens authenticate it', async () => {
    const sessions = await testSessions()

    const up = (
      await sessions.signUp({ email: 'ann@example.test', password: 'pass-word-1' }, laptop)
    )._unsafeUnwrap()
    const again = (
      await sessions.signIn({ email: 'ann@example.test', password: 'pass-word-1' }, laptop)
    )._unsafeUnwrap()
    const device = (await sessions.authenticate(again.tokens, anyRenewal))._unsafeUnwrap()

    expect(up.identity.id).toMatch(/^idn_/)
    expect(up.identity).toEqual({ id: up.identity.id, email: ann.email })
    expect(up.tokens.refresh).toMatch(/\S/)
    expect(device.identity.id).toBe(up.identity.id)
    expect(device.renewed).toBe(false)
    expect(device.tokens).toEqual(again.tokens)
  })

  it('renews the pair with the refresh key when the access token is not accepted', async () => {
    const sessions = await testSessions()
    const { identity, tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    const device = (
      await sessions.authenticate(
        { access: 'expired.or.garbage', refresh: tokens.refresh },
        anyRenewal,
      )
    )._unsafeUnwrap()

    expect(device.renewed).toBe(true)
    expect(device.identity).toEqual(identity)
    expect(device.tokens.access).toMatch(/^ey/)
    expect(device.tokens.refresh).toMatch(/\S/)
    expect(device.tokens.refresh).not.toBe(tokens.refresh)
    // The key it replaced is spent.
    expect(
      (
        await sessions.authenticate(
          { access: 'expired.or.garbage', refresh: tokens.refresh },
          anyRenewal,
        )
      )._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('asks the gate only when the access token no longer works', async () => {
    const sessions = await testSessions()
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    const device = (
      await sessions.authenticate(tokens, () => expect.unreachable('the gate was asked'))
    )._unsafeUnwrap()

    expect(device.renewed).toBe(false)
  })

  it('fails data:RATE_LIMITED and spends nothing when the gate refuses the renewal', async () => {
    const sessions = await testSessions()
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const stale = { access: 'expired.or.garbage', refresh: tokens.refresh }
    let asked = 0

    const refused = await sessions.authenticate(stale, () => {
      asked += 1

      return false
    })

    expect(refused._unsafeUnwrapErr()).toEqual({
      code: 'data:RATE_LIMITED',
      message: 'too many renewals',
    })
    expect(asked).toBe(1)
    // The refresh key was not spent: the same pair renews once the gate lets it through.
    expect((await sessions.authenticate(stale, anyRenewal))._unsafeUnwrap().renewed).toBe(true)
  })

  it('asks no gate and spends nothing when the database could not judge the access token', async () => {
    const local = await testDb()
    const sessions = sessionsOver(local)
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const stale = { access: 'expired.or.garbage', refresh: tokens.refresh }
    // The check of the access token fails as an outage would; a refresh exchange would go through.
    const unjudging = new IdentitySessions({
      openAuth: () => {
        const auth = createAuth(local, identityAccess)

        return {
          ...auth,
          resume: (presented) =>
            presented.refresh === undefined
              ? errAsync(dataError('data:QUERY_FAILED', 'the database cannot be reached'))
              : auth.resume(presented),
        }
      },
      scope: identityAccess,
      onFailure: (error) => reportedFailures.push(error),
      devices: recordingDevices().devices,
      clock: manualClock(),
    })
    let asked = 0

    const failed = await unjudging.authenticate(stale, () => {
      asked += 1

      return true
    })

    expect(failed._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    expect(asked).toBe(0)
    // The refresh key was not spent: the same pair renews once the database answers.
    expect((await sessions.authenticate(stale, anyRenewal))._unsafeUnwrap().renewed).toBe(true)
  })

  it('fails a refresh key that came without a gate as unjudged, never as refused keys', async () => {
    const sessions = await testSessions()
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const stale = { access: 'expired.or.garbage', refresh: tokens.refresh }
    // The overloads give every refresh key its gate; a caller typed loosely can still leave it out.
    const loose: {
      authenticate(tokens: {
        readonly access: string
        readonly refresh?: string
      }): ResultAsync<AuthenticatedDevice, DataError>
    } = sessions

    expect((await loose.authenticate(stale))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
    // Nothing was spent.
    expect((await sessions.authenticate(stale, anyRenewal))._unsafeUnwrap().renewed).toBe(true)
  })

  it('refuses wrong credentials and an unknown refresh key', async () => {
    const sessions = await testSessions()

    expect((await sessions.signUp(ann, laptop)).isOk()).toBe(true)

    expect(
      (await sessions.signIn({ ...ann, password: 'wrong' }, laptop))._unsafeUnwrapErr().code,
    ).toBe('data:INVALID_CREDENTIALS')
    expect(
      (
        await sessions.authenticate({ access: 'x', refresh: 'surreal-refresh-unknown' }, anyRenewal)
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await sessions.authenticate({ access: 'x', refresh: 'surreal-refresh-unknown' }, anyRenewal)
      )._unsafeUnwrapErr().code,
    ).toBe('data:AUTH_FAILED')
  })

  it('refuses an access token that is not accepted when no refresh key comes with it', async () => {
    const sessions = await testSessions()

    expect((await sessions.authenticate({ access: 'x' }))._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
  })

  it('refuses a second sign-up with the same email', async () => {
    const sessions = await testSessions()

    expect((await sessions.signUp(ann, laptop)).isOk()).toBe(true)
    expect((await sessions.signUp(ann, laptop))._unsafeUnwrapErr().code).toBe(
      'data:SIGN_UP_REJECTED',
    )
  })

  it('fails a sign-in whose reply carries no refresh key instead of answering without one', async () => {
    const withoutRefresh = readFileSync(
      new URL('./__fixtures__/identity-without-refresh.surql', import.meta.url),
      'utf8',
    )
    const sessions = sessionsOver(await testDb(`${readSchema('directory')}\n${withoutRefresh}`))

    expect((await sessions.signUp(ann, laptop))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect((await sessions.signIn(ann, laptop))._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
  })

  it('refuses an access token of another access method', async () => {
    const local = await testDb(`${readSchema('directory')}\n${elsewhereAccess}`)
    const elsewhere = createAuth(local, { ...identityAccess, access: 'elsewhere' })

    ;(await elsewhere.signUp(ann))._unsafeUnwrap()

    const token = elsewhere.tokens()?.access ?? expect.unreachable('a token of the other access')
    const error = (await sessionsOver(local).authenticate({ access: token }))._unsafeUnwrapErr()

    expect(error.code).toBe('data:AUTH_FAILED')
  })

  it('never renews beside such a token', async () => {
    const local = await testDb(`${readSchema('directory')}\n${elsewhereAccess}`)
    const sessions = sessionsOver(local)
    const elsewhere = createAuth(local, { ...identityAccess, access: 'elsewhere' })

    ;(
      await elsewhere.signUp({ email: 'bob@example.test', password: 'pass-word-2' })
    )._unsafeUnwrap()

    const token = elsewhere.tokens()?.access ?? expect.unreachable('a token of the other access')
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const refused = await sessions.authenticate(
      { access: token, refresh: tokens.refresh },
      anyRenewal,
    )
    const renewed = (
      await sessions.authenticate(
        { access: 'expired.or.garbage', refresh: tokens.refresh },
        anyRenewal,
      )
    )._unsafeUnwrap()

    expect(refused._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    // The refresh key was not spent by the refused call.
    expect(renewed.renewed).toBe(true)
  })

  it('keeps the result of a call whose database session fails to close, and reports the failure', async () => {
    const local = await testDb()
    const failures: DataError[] = []
    const sessions = sessionsOver(local, { onFailure: (error) => failures.push(error) })

    failClosing(local)

    // The identity exists once the sign-up answered, so its pair must reach the device.
    const { identity, tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    // The renewal spent the old key, so the new pair must reach the device too.
    const device = (
      await sessions.authenticate(
        { access: 'expired.or.garbage', refresh: tokens.refresh },
        anyRenewal,
      )
    )._unsafeUnwrap()
    const renewed = device.renewed ? device.tokens : expect.unreachable('a renewed pair')
    const again = await sessions.authenticate(
      {
        access: 'expired.or.garbage',
        refresh: renewed.refresh,
      },
      anyRenewal,
    )

    expect(device.identity).toEqual(identity)
    expect(renewed.refresh).not.toBe(tokens.refresh)
    expect(again._unsafeUnwrap().identity).toEqual(identity)
    expect(failures.map((failure) => [failure.code, failure.message])).toEqual(
      Array.from({ length: 3 }, () => [
        'data:QUERY_FAILED',
        'the auth session could not be closed',
      ]),
    )
  })

  it('fails a call the database could not judge as unjudged, never as refused keys', async () => {
    const local = await testDb()
    const sessions = sessionsOver(local)
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    failOpening(local)

    const codes = [
      (await sessions.signUp({ ...ann, email: 'bob@example.test' }, laptop))._unsafeUnwrapErr()
        .code,
      (await sessions.signIn(ann, laptop))._unsafeUnwrapErr().code,
      (await sessions.authenticate({ access: tokens.access }))._unsafeUnwrapErr().code,
      (await sessions.authenticate(tokens, anyRenewal))._unsafeUnwrapErr().code,
    ]

    expect(codes).toEqual(Array.from({ length: 4 }, () => 'data:QUERY_FAILED'))
  })

  it('fails as unjudged, never as refused keys, when a call throws', async () => {
    const local = await testDb()
    const sessions = new IdentitySessions({
      openAuth: () => ({
        ...createAuth(local, identityAccess),
        resume: () => {
          throw new Error('the driver failed')
        },
      }),
      scope: identityAccess,
      onFailure: (error) => reportedFailures.push(error),
      devices: recordingDevices().devices,
      clock: manualClock(),
    })

    expect((await sessions.authenticate({ access: 'x' }))._unsafeUnwrapErr().code).toBe(
      'data:QUERY_FAILED',
    )
  })

  it('closes the database session of every call', async () => {
    const { sessions, opened, closed } = await countingSessions()

    expect((await sessions.signUp(ann, laptop)).isOk()).toBe(true)
    expect((await sessions.signIn(ann, laptop)).isOk()).toBe(true)
    expect((await sessions.signIn({ ...ann, password: 'wrong' }, laptop)).isErr()).toBe(true)
    expect(
      (
        await sessions.authenticate({ access: 'x', refresh: 'surreal-refresh-x' }, anyRenewal)
      ).isErr(),
    ).toBe(true)

    expect(opened()).toBe(4)
    expect(closed()).toBe(opened())
  })
})

describe('grantIdOf', () => {
  it('reads the grant id out of a refresh key', () => {
    expect(grantIdOf('surreal-refresh-abc-def')).toBe('abc')
    expect(grantIdOf('surreal-refresh-G7k2Lm9Qx3Ab-not-a-real-secret')).toBe('G7k2Lm9Qx3Ab')
  })

  it('answers undefined for anything that is not a refresh key', () => {
    expect(grantIdOf('x')).toBeUndefined()
    expect(grantIdOf('surreal-refresh-abc')).toBeUndefined()
    expect(grantIdOf('surreal-refresh--def')).toBeUndefined()
    expect(grantIdOf('surreal-access-abc-def')).toBeUndefined()
  })
})

describe('IdentitySessions and the devices', () => {
  it('records the device of a sign-up and of a sign-in with the grant of its refresh key and the second its token was issued in', async () => {
    const { touched, devices } = recordingDevices()
    const sessions = sessionsOver(await testDb(), { devices })
    const phone = { id: 'device-phone', label: 'Safari on iPhone' }

    const up = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const again = (await sessions.signIn(ann, phone))._unsafeUnwrap()

    expect(touched).toEqual([
      {
        identity: up.identity.id,
        device: laptop.id,
        label: laptop.label,
        grant: grantIdOf(up.tokens.refresh),
        startedAt: issuedAtOf(up.tokens.access),
      },
      {
        identity: up.identity.id,
        device: phone.id,
        label: phone.label,
        grant: grantIdOf(again.tokens.refresh),
        startedAt: issuedAtOf(again.tokens.access),
      },
    ])
    expect(touched.every(({ startedAt }) => startedAt instanceof Date)).toBe(true)
    expect(grantIdOf(up.tokens.refresh)).toMatch(/\S/)
  })

  it('fails a sign-in whose device cannot be recorded', async () => {
    let refusing = false
    const { devices } = recordingDevices({ refuse: () => refusing })
    const sessions = sessionsOver(await testDb(), { devices })

    expect((await sessions.signUp(ann, laptop)).isOk()).toBe(true)

    refusing = true

    expect((await sessions.signIn(ann, laptop))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
  })

  it('revokes the grant a sign-in minted when its device cannot be recorded', async () => {
    let refusing = false
    const { touched, revoked, devices } = recordingDevices({ refuse: () => refusing })
    const sessions = sessionsOver(await testDb(), { devices })
    const up = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    refusing = true

    expect((await sessions.signIn(ann, laptop))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')

    const minted = touched.at(-1)?.grant

    expect(minted).toMatch(/\S/)
    expect(minted).not.toBe(grantIdOf(up.tokens.refresh))
    expect(revoked).toEqual([{ identity: up.identity.id, grant: minted }])
  })

  it('leaves no live grant behind a sign-in whose device cannot be recorded', async () => {
    const local = await testDb()
    let refusing = false
    const real = new DeviceSessions({ directory: local, clock: manualClock(Date.now()) })
    const sessions = sessionsOver(local, {
      devices: {
        touch: (input) =>
          refusing
            ? errAsync(dataError('data:WRITE_FAILED', 'the directory refused the device'))
            : real.touch(input),
        revokeGrant: (input) => real.revokeGrant(input),
      },
    })
    const up = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    refusing = true

    expect((await sessions.signIn(ann, laptop)).isErr()).toBe(true)

    const [grants] = await local.db.query<[unknown[]]>(liveGrantsStatement, {
      identity: up.identity.id,
    })

    expect(grants).toHaveLength(1)
  })

  it('answers the failure to record the device and reports a minted grant it could not revoke', async () => {
    const { devices } = recordingDevices({ refuse: () => true, failRevokes: true })
    const failures: DataError[] = []
    const sessions = sessionsOver(await testDb(), {
      devices,
      onFailure: (error) => failures.push(error),
    })

    const failed = (await sessions.signUp(ann, laptop))._unsafeUnwrapErr()

    expect([failed.code, failed.message]).toEqual([
      'data:WRITE_FAILED',
      'the directory refused the device',
    ])
    expect(failures.map((failure) => [failure.code, failure.message])).toEqual([
      ['data:WRITE_FAILED', 'the directory refused the revoke'],
    ])
  })

  it("forgets the pairs parked for the device once it signs in again, and no other device's", async () => {
    const sessions = sessionsOver(await testDb())
    const up = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const spent = 'surreal-refresh-spent-secret'
    const pair = { access: 'renewed-access', refresh: 'surreal-refresh-renewed-secret' }

    sessions.park({
      identity: up.identity.id,
      device: laptop.id,
      spentRefresh: spent,
      tokens: pair,
    })
    sessions.park({
      identity: up.identity.id,
      device: 'device-phone',
      spentRefresh: spent,
      tokens: pair,
    })

    ;(await sessions.signIn(ann, laptop))._unsafeUnwrap()

    expect(sessions.parked({ device: laptop.id, refresh: spent })).toBeUndefined()
    expect(sessions.parked({ device: 'device-phone', refresh: spent })?.tokens).toEqual(pair)
  })

  it("revokes the grant a device's row held before when the device signs in again", async () => {
    const { revoked, devices } = recordingDevices()
    const sessions = sessionsOver(await testDb(), { devices })
    const phone = { id: 'device-phone', label: 'Safari on iPhone' }

    const up = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    ;(await sessions.signIn(ann, phone))._unsafeUnwrap()

    expect(revoked).toEqual([])

    ;(await sessions.signIn(ann, laptop))._unsafeUnwrap()

    expect(revoked).toEqual([{ identity: up.identity.id, grant: grantIdOf(up.tokens.refresh) }])
  })

  it('leaves the first pair of a device dead once it signs in again, and the second alive', async () => {
    const local = await testDb()
    const sessions = sessionsOver(local, {
      devices: new DeviceSessions({ directory: local, clock: manualClock(Date.now()) }),
    })

    const first = (await sessions.signUp(ann, laptop))._unsafeUnwrap()
    const second = (await sessions.signIn(ann, laptop))._unsafeUnwrap()

    expect(
      (
        await sessions.authenticate({ access: 'stale', refresh: first.tokens.refresh }, anyRenewal)
      ).isErr(),
    ).toBe(true)
    expect(
      (
        await sessions.authenticate({ access: 'stale', refresh: second.tokens.refresh }, anyRenewal)
      ).isOk(),
    ).toBe(true)
  })

  it('signs in when the old grant cannot be revoked, and reports the failure', async () => {
    const { devices } = recordingDevices({ failRevokes: true })
    const failures: DataError[] = []
    const sessions = sessionsOver(await testDb(), {
      devices,
      onFailure: (error) => failures.push(error),
    })

    ;(await sessions.signUp(ann, laptop))._unsafeUnwrap()

    expect((await sessions.signIn(ann, laptop)).isOk()).toBe(true)
    expect(failures.map((failure) => failure.code)).toEqual(['data:WRITE_FAILED'])
  })

  it('records nothing at a renewal: the hello binds the device to its row', async () => {
    const { touched, devices } = recordingDevices()
    const sessions = sessionsOver(await testDb(), { devices })
    const { tokens } = (await sessions.signUp(ann, laptop))._unsafeUnwrap()

    const renewed = (
      await sessions.authenticate({ access: 'stale', refresh: tokens.refresh }, anyRenewal)
    )._unsafeUnwrap()

    expect(renewed.renewed).toBe(true)
    expect(touched).toHaveLength(1)
  })
})

describe('IdentitySessions parking', () => {
  const spent = 'surreal-refresh-spent-secret'
  const pair = { access: 'renewed-access', refresh: 'surreal-refresh-renewed-secret' }
  const annId = identityIdFactory.create()
  const bobId = identityIdFactory.create()

  async function parkingSessions() {
    const clock = manualClock(1_000_000)

    return { clock, sessions: sessionsOver(await testDb(), { clock }) }
  }

  it('hands a parked pair once to the device that presents the spent refresh key, within 60 s', async () => {
    const { clock, sessions } = await parkingSessions()

    sessions.park({ identity: annId, device: laptop.id, spentRefresh: spent, tokens: pair })
    await clock.advance(59_999)

    expect(sessions.parked({ device: 'device-phone', refresh: spent })).toBeUndefined()
    expect(
      sessions.parked({ device: laptop.id, refresh: 'surreal-refresh-other-key' }),
    ).toBeUndefined()
    expect(sessions.parked({ device: laptop.id, refresh: spent })).toEqual({
      identity: annId,
      tokens: pair,
    })
    expect(sessions.parked({ device: laptop.id, refresh: spent })).toBeUndefined()
  })

  it('forgets a parked pair after 60 s', async () => {
    const { clock, sessions } = await parkingSessions()

    sessions.park({ identity: annId, device: laptop.id, spentRefresh: spent, tokens: pair })
    await clock.advance(60_000)

    expect(sessions.parked({ device: laptop.id, refresh: spent })).toBeUndefined()
  })

  it("forgets the pairs parked for a device of the identity that was signed out, and no other identity's", async () => {
    const { sessions } = await parkingSessions()
    const bobs = 'surreal-refresh-bobs-secret'

    sessions.park({ identity: annId, device: laptop.id, spentRefresh: spent, tokens: pair })
    sessions.park({ identity: annId, device: 'device-phone', spentRefresh: spent, tokens: pair })
    sessions.park({ identity: bobId, device: laptop.id, spentRefresh: bobs, tokens: pair })
    sessions.unpark(annId, laptop.id)

    expect(sessions.parked({ device: laptop.id, refresh: spent })).toBeUndefined()
    expect(sessions.parked({ device: laptop.id, refresh: bobs })?.tokens).toEqual(pair)
    expect(sessions.parked({ device: 'device-phone', refresh: spent })?.tokens).toEqual(pair)
  })

  it('forgets every pair parked for the identity when no device is named', async () => {
    const { sessions } = await parkingSessions()
    const bobs = 'surreal-refresh-bobs-secret'

    sessions.park({ identity: annId, device: laptop.id, spentRefresh: spent, tokens: pair })
    sessions.park({ identity: annId, device: 'device-phone', spentRefresh: spent, tokens: pair })
    sessions.park({ identity: bobId, device: laptop.id, spentRefresh: bobs, tokens: pair })
    sessions.unpark(annId)

    expect(sessions.parked({ device: laptop.id, refresh: spent })).toBeUndefined()
    expect(sessions.parked({ device: 'device-phone', refresh: spent })).toBeUndefined()
    expect(sessions.parked({ device: laptop.id, refresh: bobs })?.tokens).toEqual(pair)
  })
})
