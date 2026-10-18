import { afterEach, describe, expect, it } from 'vitest'

import { type AuthTokens, createAuth, fromDriverValue, type LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { device_sessionIdFactory, type IdentityId } from '@workspace/ids'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import sessionsRevokedAtStatement from './__fixtures__/identity-sessions-revoked-at.surql'
import { DeviceSessions } from './device-sessions'
import { grantIdOf } from './identity-sessions'
import deviceTouchStatement from './surql/device-touch.surql'
import grantRevokeStatement from './surql/grant-revoke.surql'
import grantsRevokeAllStatement from './surql/grants-revoke-all.surql'
import sessionsRevokedStatement from './surql/identity-sessions-revoked.surql'
import { issuedAtOf } from './token-claims'

const PASSWORD = 'pass-word-1'

const DAY_MS = 24 * 60 * 60 * 1000

const opened: LocalDb[] = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((local) => local.close()))
})

async function directory(): Promise<LocalDb> {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()

  opened.push(local)

  return local
}

/** An auth session on the directory's access method, closed once `run` is done. */
async function withAuth<T>(
  local: LocalDb,
  run: (auth: ReturnType<typeof createAuth>) => Promise<T>,
): Promise<T> {
  const auth = createAuth(local, {
    access: 'identity',
    namespace: NAMESPACE,
    database: DIRECTORY,
  })

  try {
    return await run(auth)
  } finally {
    await auth.close()
  }
}

/** An identity signed in through the directory's access method: its id and its pair. */
interface Signed {
  readonly identity: IdentityId
  readonly access: string
  readonly refresh: string
}

/** Signs an identity up, or in again, through the directory's access method. */
async function signed(local: LocalDb, email: string, how: 'signUp' | 'signIn'): Promise<Signed> {
  return withAuth(local, async (auth) => {
    const user = (await auth[how]({ email, password: PASSWORD }))._unsafeUnwrap()
    const tokens = auth.tokens()

    if (tokens?.refresh === undefined) {
      return expect.unreachable('a sign-in with a refresh key')
    }

    return { identity: user.id, access: tokens.access, refresh: tokens.refresh }
  })
}

const signUp = (local: LocalDb, email: string): Promise<Signed> => signed(local, email, 'signUp')

/** Whether the access token `access` still signs its identity in, without a refresh key. */
async function accepted(local: LocalDb, access: string): Promise<boolean> {
  return withAuth(local, async (auth) => (await auth.resume({ access })).isOk())
}

/** When the access token `access` was issued: its `iat`, a whole second, in milliseconds. */
function issuedAt(access: string): number {
  return (
    issuedAtOf(access) ?? expect.unreachable('a token that names when it was issued')
  ).getTime()
}

/** The second the device sessions of most tests started in, as a sign-in names it. */
const SESSION = new Date(1_760_000_000_000)

/** The refresh key of the pair `refresh` renews to, or `undefined` when it renews nothing. */
async function renew(local: LocalDb, refresh: string): Promise<string | undefined> {
  const tokens: AuthTokens = { access: 'expired.or.garbage', refresh }

  return withAuth(local, async (auth) =>
    (await auth.resume(tokens)).isOk() ? auth.tokens()?.refresh : undefined,
  )
}

/** The grant id of a refresh key, which every refresh key names. */
function grantOf(refresh: string): string {
  return grantIdOf(refresh) ?? expect.unreachable('a refresh key that names its grant')
}

async function harness(clock: ManualClock = manualClock(Date.now())) {
  const local = await directory()

  return { local, clock, devices: new DeviceSessions({ directory: local, clock }) }
}

describe('DeviceSessions', () => {
  it('records a device once per identity and device, renewing its grant and label', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')

    const first = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Firefox on Linux',
        grant: 'grant-1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row
    const revoked = (await devices.revoke({ identity: ann.identity, id: first.id }))._unsafeUnwrap()
    const again = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Chrome on Linux',
        grant: 'grant-2',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row

    expect(device_sessionIdFactory.is(first.id)).toBe(true)
    expect(first).toMatchObject({
      identity: ann.identity,
      device: 'device-laptop',
      label: 'Firefox on Linux',
      grant: 'grant-1',
    })
    expect(first.revokedAt).toBeUndefined()
    expect(first.createdAt).toBeInstanceOf(Date)
    expect(first.lastSeenAt).toBeInstanceOf(Date)
    expect(revoked?.revokedAt).toBeInstanceOf(Date)
    expect(again).toMatchObject({
      id: first.id,
      label: 'Chrome on Linux',
      grant: 'grant-2',
      createdAt: first.createdAt,
    })
    expect(again.revokedAt).toBeUndefined()
    expect(again.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime())
  })

  it('answers the grant a touched row held before, and none for a new row', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const touch = (grant: string) =>
      devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Laptop',
        grant,
        startedAt: SESSION,
      })

    const first = (await touch('grant-1'))._unsafeUnwrap()
    const second = (await touch('grant-2'))._unsafeUnwrap()

    expect(first.previous).toBeUndefined()
    expect(first.row.grant).toBe('grant-1')
    expect(second.previous).toBe('grant-1')
    expect(second.row).toMatchObject({ id: first.row.id, grant: 'grant-2' })
  })

  it('records a new device once when two sign-ins on it touch it at the same moment', async () => {
    const local = await directory()
    let release = () => {}
    const together = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = 0
    const devices = new DeviceSessions({
      // Both touches wait until both are in flight, then reach the database at once.
      directory: interceptQueries(local, (text) => {
        if (text !== deviceTouchStatement) {
          return undefined
        }

        held += 1

        if (held === 2) {
          release()
        }

        return together
      }),
      clock: manualClock(Date.now()),
    })
    const ann = await signUp(local, 'ann@example.test')
    const touch = (grant: string) =>
      devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Laptop',
        grant,
        startedAt: SESSION,
      })

    const touched = (await Promise.all([touch('grant-1'), touch('grant-2')])).map((result) =>
      result._unsafeUnwrap(),
    )
    const rows = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(rows).toHaveLength(1)
    expect(new Set(touched.map(({ row }) => row.id))).toEqual(new Set([rows[0]?.id]))
    // One of them made the row. The other's write conflicted with it, and the retry every write
    // is sent with replayed it: it found the row and took its grant over.
    expect(
      touched.map(({ previous }) => previous).filter((previous) => previous !== undefined),
    ).toHaveLength(1)
  })

  it('lists the devices of the identity only, the earliest first', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')

    for (const [identity, device] of [
      [ann.identity, 'device-laptop'],
      [bob.identity, 'device-bobs'],
      [ann.identity, 'device-phone'],
    ] as const) {
      ;(
        await devices.touch({
          identity,
          device,
          label: device,
          grant: `${device}-grant`,
          startedAt: SESSION,
        })
      )._unsafeUnwrap()
    }

    const listed = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(listed.map((row) => row.device)).toEqual(['device-laptop', 'device-phone'])
    expect(listed.every((row) => row.identity === ann.identity)).toBe(true)
  })

  it('lists a device revoked within the last 30 days, and no device revoked before', async () => {
    const now = Date.now()
    const clock = manualClock(now)
    const { local, devices } = await harness(clock)
    const ann = await signUp(local, 'ann@example.test')
    const laptop = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Laptop',
        grant: 'grant-1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-phone',
        label: 'Phone',
        grant: 'grant-2',
        startedAt: SESSION,
      })
    )._unsafeUnwrap()
    ;(await devices.revoke({ identity: ann.identity, id: laptop.id }))._unsafeUnwrap()

    const soon = (await devices.list(ann.identity))._unsafeUnwrap()

    await clock.advance(30 * DAY_MS + 60_000)

    const later = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(soon.map((row) => row.device)).toEqual(['device-laptop', 'device-phone'])
    expect(later.map((row) => row.device)).toEqual(['device-phone'])
  })

  it('marks the seen time of a device', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const touched = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Laptop',
        grant: 'grant-1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row

    await new Promise((resolve) => setTimeout(resolve, 5))
    ;(await devices.seen({ identity: ann.identity, device: 'device-laptop' }))._unsafeUnwrap()

    const [seen] = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(seen?.lastSeenAt.getTime()).toBeGreaterThan(touched.lastSeenAt.getTime())
  })

  it("revokes a device of the identity and its refresh grant, and no other identity's device", async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')
    const anns = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Laptop',
        grant: grantOf(ann.refresh),
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row

    expect((await devices.revoke({ identity: bob.identity, id: anns.id }))._unsafeUnwrap()).toBe(
      undefined,
    )
    expect(
      (
        await devices.revoke({ identity: ann.identity, id: device_sessionIdFactory.create() })
      )._unsafeUnwrap(),
    ).toBe(undefined)
    // Neither marked Ann's row, before anything touches it again.
    expect((await devices.list(ann.identity))._unsafeUnwrap()[0]?.revokedAt).toBeUndefined()

    // Neither touched Ann's grant; its renewal replaces it, and the row holds the new one.
    const current = (await renew(local, ann.refresh)) ?? expect.unreachable('a renewed pair')

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Laptop',
        grant: grantOf(current),
        startedAt: SESSION,
      })
    )._unsafeUnwrap()

    const revoked = (await devices.revoke({ identity: ann.identity, id: anns.id }))._unsafeUnwrap()

    expect(revoked).toMatchObject({ id: anns.id, device: 'device-laptop' })
    expect(revoked?.revokedAt).toBeInstanceOf(Date)
    expect(await renew(local, current)).toBeUndefined()
    expect(await renew(local, bob.refresh)).toMatch(/^surreal-refresh-/)
  })

  it('binds a device to its row: bound, revoked or missing', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')
    const laptop = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'L',
        grant: 'g1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-phone',
        label: 'P',
        grant: 'g2',
        startedAt: SESSION,
      })
    )._unsafeUnwrap()
    ;(await devices.revoke({ identity: ann.identity, id: laptop.id }))._unsafeUnwrap()

    const bind = async (identity: IdentityId, device: string) =>
      (await devices.bind({ identity, device, issuedAt: SESSION }))._unsafeUnwrap()

    expect(await bind(ann.identity, 'device-phone')).toMatchObject({
      kind: 'bound',
      row: { device: 'device-phone', grant: 'g2' },
    })
    expect(await bind(ann.identity, 'device-laptop')).toMatchObject({
      kind: 'revoked',
      row: { id: laptop.id },
    })
    expect(await bind(ann.identity, 'device-tablet')).toEqual({ kind: 'missing' })
    // Another identity's device of the same id is not this one's.
    expect(await bind(bob.identity, 'device-phone')).toEqual({ kind: 'missing' })
  })

  it('rotates the grant of a device only from the grant it holds, and only while it is not revoked', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const laptop = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'L',
        grant: 'g1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row
    const rotate = async (device: string, spent: string, next: string) =>
      (
        await devices.rotate({ identity: ann.identity, device, spent, next, issuedAt: SESSION })
      )._unsafeUnwrap()

    const moved = await rotate('device-laptop', 'g1', 'g2')
    const fromAnother = await rotate('device-laptop', 'g1', 'g3')
    const unknown = await rotate('device-tablet', 'g2', 'g3')

    expect(moved).toMatchObject({ kind: 'bound', row: { id: laptop.id, grant: 'g2' } })
    expect(fromAnother).toEqual({ kind: 'other-grant' })
    expect(unknown).toEqual({ kind: 'missing' })

    ;(await devices.revoke({ identity: ann.identity, id: laptop.id }))._unsafeUnwrap()

    expect(await rotate('device-laptop', 'g2', 'g3')).toMatchObject({ kind: 'revoked' })

    const [row] = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(row?.grant).toBe('g2')
    expect(row?.revokedAt).toBeInstanceOf(Date)
  })

  it('records when the current session of a device started, and moves it with every sign-in', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const later = new Date(SESSION.getTime() + 60_000)
    const touch = (grant: string, startedAt: Date) =>
      devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'L',
        grant,
        startedAt,
      })

    const first = (await touch('g1', SESSION))._unsafeUnwrap().row
    const again = (await touch('g2', later))._unsafeUnwrap().row
    const [listed] = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(first.startedAt).toEqual(SESSION)
    expect(again.startedAt).toEqual(later)
    expect(listed?.startedAt).toEqual(later)
  })

  it("binds a token issued before its device's session started as stale, one issued in that second or after as bound", async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'L',
        grant: 'g1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap()

    const bind = async (issuedAt: Date) =>
      (
        await devices.bind({ identity: ann.identity, device: 'device-laptop', issuedAt })
      )._unsafeUnwrap().kind

    expect(await bind(new Date(SESSION.getTime() - 1_000))).toBe('stale-token')
    expect(await bind(SESSION)).toBe('bound')
    expect(await bind(new Date(SESSION.getTime() + 1_000))).toBe('bound')

    const rotate = async (spent: string, next: string, issuedAt: Date) =>
      (
        await devices.rotate({
          identity: ann.identity,
          device: 'device-laptop',
          spent,
          next,
          issuedAt,
        })
      )._unsafeUnwrap().kind

    // A renewal's token is issued as it renews, after its session started; an earlier one is not.
    expect(await rotate('g1', 'g2', new Date(SESSION.getTime() - 1_000))).toBe('stale-token')
    expect(await rotate('g2', 'g3', new Date(SESSION.getTime() + 1_000))).toBe('bound')
  })

  it("marks the device of a signed-out pair by its grant, once, and no other identity's device", async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'L',
        grant: 'g1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap()

    expect((await devices.signedOut({ identity: bob.identity, grant: 'g1' }))._unsafeUnwrap()).toBe(
      undefined,
    )
    expect((await devices.signedOut({ identity: ann.identity, grant: 'g9' }))._unsafeUnwrap()).toBe(
      undefined,
    )

    const marked = (
      await devices.signedOut({ identity: ann.identity, grant: 'g1' })
    )._unsafeUnwrap()

    expect(marked).toMatchObject({ device: 'device-laptop', grant: 'g1' })
    expect(marked?.revokedAt).toBeInstanceOf(Date)

    // A device signed out already answers its row again, signed out when it first was.
    const again = (await devices.signedOut({ identity: ann.identity, grant: 'g1' }))._unsafeUnwrap()

    expect(again?.id).toBe(marked?.id)
    expect(again?.revokedAt).toEqual(marked?.revokedAt)
  })

  it("revokes one refresh grant of the identity, and no other identity's", async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')

    ;(
      await devices.revokeGrant({ identity: bob.identity, grant: grantOf(ann.refresh) })
    )._unsafeUnwrap()

    const current = (await renew(local, ann.refresh)) ?? expect.unreachable('a renewed pair')

    ;(
      await devices.revokeGrant({ identity: ann.identity, grant: grantOf(current) })
    )._unsafeUnwrap()

    expect(await renew(local, current)).toBeUndefined()
  })

  it('answers a revoke that failed after marking the row with that row, the failure partial', async () => {
    const local = await directory()
    const devices = new DeviceSessions({
      directory: interceptQueries(local, (text) => {
        if (text === grantRevokeStatement) {
          throw new Error('the directory went away')
        }
      }),
      clock: manualClock(Date.now()),
    })
    const ann = await signUp(local, 'ann@example.test')
    const laptop = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'L',
        grant: 'g1',
        startedAt: SESSION,
      })
    )._unsafeUnwrap().row

    const failure = (
      await devices.revoke({ identity: ann.identity, id: laptop.id })
    )._unsafeUnwrapErr()

    expect('kind' in failure && failure.kind === 'partial' ? failure.row?.device : undefined).toBe(
      'device-laptop',
    )
    expect((await devices.list(ann.identity))._unsafeUnwrap()[0]?.revokedAt).toBeInstanceOf(Date)
  })

  it('answers a sign-out everywhere that failed after its first write as partial, and one that failed before as a failure', async () => {
    let refused: string | undefined
    const local = await directory()
    const devices = new DeviceSessions({
      directory: interceptQueries(local, (text) => {
        if (text === refused) {
          throw new Error('the directory went away')
        }
      }),
      clock: manualClock(Date.now()),
    })
    const ann = await signUp(local, 'ann@example.test')

    refused = sessionsRevokedStatement

    const before = (await devices.revokeAll(ann.identity))._unsafeUnwrapErr()

    refused = grantsRevokeAllStatement

    const after = (await devices.revokeAll(ann.identity))._unsafeUnwrapErr()

    expect('kind' in before).toBe(false)
    expect('kind' in after && after.kind === 'partial').toBe(true)
  })

  it('revokes every device of the identity, its grants and the tokens issued before', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')

    for (const device of ['device-laptop', 'device-phone']) {
      ;(
        await devices.touch({
          identity: ann.identity,
          device,
          label: device,
          grant: device,
          startedAt: SESSION,
        })
      )._unsafeUnwrap()
    }

    ;(
      await devices.touch({
        identity: bob.identity,
        device: 'device-bobs',
        label: 'Bob',
        grant: 'bob',
        startedAt: SESSION,
      })
    )._unsafeUnwrap()
    ;(await devices.revokeAll(ann.identity))._unsafeUnwrap()

    const [anns] = await local.db.query<[unknown]>(sessionsRevokedAtStatement, {
      identity: ann.identity,
    })
    const [bobs] = await local.db.query<[unknown]>(sessionsRevokedAtStatement, {
      identity: bob.identity,
    })
    const annsDevices = (await devices.list(ann.identity))._unsafeUnwrap()

    expect(fromDriverValue(anns)).toBeInstanceOf(Date)
    expect(bobs ?? undefined).toBeUndefined()
    expect(annsDevices).toHaveLength(2)
    expect(annsDevices.every((row) => row.revokedAt instanceof Date)).toBe(true)
    expect((await devices.list(bob.identity))._unsafeUnwrap()[0]?.revokedAt).toBeUndefined()
    expect(await renew(local, ann.refresh)).toBeUndefined()
    expect(await renew(local, bob.refresh)).toMatch(/^surreal-refresh-/)
  })

  it('signs out everywhere from the start of its second: a token issued in that second stays valid, one issued a second before does not', async () => {
    const { local } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')

    // Ann is signed out everywhere late in the second her token was issued, Bob late in the
    // second after his.
    await local.db.query(sessionsRevokedStatement, {
      identity: ann.identity,
      at: new Date(issuedAt(ann.access) + 999),
    })
    await local.db.query(sessionsRevokedStatement, {
      identity: bob.identity,
      at: new Date(issuedAt(bob.access) + 1_999),
    })

    const [anns] = await local.db.query<[unknown]>(sessionsRevokedAtStatement, {
      identity: ann.identity,
    })

    expect(fromDriverValue(anns)).toEqual(new Date(issuedAt(ann.access)))
    expect(await accepted(local, ann.access)).toBe(true)
    expect(await accepted(local, bob.access)).toBe(false)
  })

  it('lets the identity sign in again right after a sign-out everywhere', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')

    ;(await devices.revokeAll(ann.identity))._unsafeUnwrap()

    const again = await signed(local, 'ann@example.test', 'signIn')
    const [mark] = await local.db.query<[unknown]>(sessionsRevokedAtStatement, {
      identity: ann.identity,
    })
    const revokedAt = fromDriverValue(mark)

    expect(revokedAt).toBeInstanceOf(Date)
    expect(revokedAt instanceof Date && revokedAt.getTime() % 1_000).toBe(0)
    expect(await accepted(local, again.access)).toBe(true)
  })
})
