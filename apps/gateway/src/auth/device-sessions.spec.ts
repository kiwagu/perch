import { afterEach, describe, expect, it } from 'vitest'

import { type AuthTokens, createAuth, fromDriverValue, type LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { device_sessionIdFactory, type IdentityId } from '@workspace/ids'
import { type ManualClock, manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import sessionsRevokedAtStatement from './__fixtures__/identity-sessions-revoked-at.surql'
import { DeviceSessions } from './device-sessions'
import { grantIdOf } from './identity-sessions'

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

/** Signs an identity up through the directory's access method: its id and its pair. */
async function signUp(
  local: LocalDb,
  email: string,
): Promise<{ readonly identity: IdentityId; readonly refresh: string }> {
  return withAuth(local, async (auth) => {
    const user = (await auth.signUp({ email, password: PASSWORD }))._unsafeUnwrap()
    const refresh = auth.tokens()?.refresh

    if (refresh === undefined) {
      return expect.unreachable('a sign-up with a refresh key')
    }

    return { identity: user.id, refresh }
  })
}

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
      })
    )._unsafeUnwrap()
    const revoked = (await devices.revoke({ identity: ann.identity, id: first.id }))._unsafeUnwrap()
    const again = (
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        label: 'Chrome on Linux',
        grant: 'grant-2',
      })
    )._unsafeUnwrap()
    const renewed = (
      await devices.touch({ identity: ann.identity, device: 'device-laptop', grant: 'grant-3' })
    )._unsafeUnwrap()

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
    // A renewal names no label: the device keeps the one it signed in with.
    expect(renewed).toMatchObject({ id: first.id, label: 'Chrome on Linux', grant: 'grant-3' })
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
        await devices.touch({ identity, device, label: device, grant: `${device}-grant` })
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
      })
    )._unsafeUnwrap()

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-phone',
        label: 'Phone',
        grant: 'grant-2',
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
      })
    )._unsafeUnwrap()

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
      })
    )._unsafeUnwrap()

    expect((await devices.revoke({ identity: bob.identity, id: anns.id }))._unsafeUnwrap()).toBe(
      undefined,
    )
    expect(
      (
        await devices.revoke({ identity: ann.identity, id: device_sessionIdFactory.create() })
      )._unsafeUnwrap(),
    ).toBe(undefined)

    // Neither touched Ann's grant; its renewal replaces it, and the row holds the new one.
    const current = (await renew(local, ann.refresh)) ?? expect.unreachable('a renewed pair')

    ;(
      await devices.touch({
        identity: ann.identity,
        device: 'device-laptop',
        grant: grantOf(current),
      })
    )._unsafeUnwrap()

    const revoked = (await devices.revoke({ identity: ann.identity, id: anns.id }))._unsafeUnwrap()

    expect(revoked).toMatchObject({ id: anns.id, device: 'device-laptop' })
    expect(revoked?.revokedAt).toBeInstanceOf(Date)
    expect(await renew(local, current)).toBeUndefined()
    expect(await renew(local, bob.refresh)).toMatch(/^surreal-refresh-/)
  })

  it('revokes every device of the identity, its grants and the tokens issued before', async () => {
    const { local, devices } = await harness()
    const ann = await signUp(local, 'ann@example.test')
    const bob = await signUp(local, 'bob@example.test')

    for (const device of ['device-laptop', 'device-phone']) {
      ;(
        await devices.touch({ identity: ann.identity, device, label: device, grant: device })
      )._unsafeUnwrap()
    }

    ;(
      await devices.touch({
        identity: bob.identity,
        device: 'device-bobs',
        label: 'Bob',
        grant: 'bob',
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
})
