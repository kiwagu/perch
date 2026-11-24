import { okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { tenantRegionId } from '@workspace/data'
import { identityIdFactory, tenantIdFactory } from '@workspace/ids'
import { CONTRACT_ROLES } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'
import type { SyncEngine } from '@workspace/replica/sync'
import { FakeLocks } from '@workspace/replica/testing'

import {
  organisationSettingsCommands,
  organisationSettingsShape,
} from '../features/organisation/application/organisation-settings/organisation-settings.model.gen'
import { organisationSettingsIdOf } from '../features/organisation/application/organisation-settings/organisation-settings-id'

import { browserDatabases, openTestWorld, type TestWorld } from './__fixtures__/session'
import { signedIn } from './__fixtures__/signed-in'
import { createCommandBus } from './commands'
import {
  type OrganisationStartsDeps,
  organisationStarts,
  START_RETRY_MS,
} from './organisation-starts'
import { type KeptDevice, memoryStorage } from './storage'

/**
 * The organisations' settings rows a browser ensures: in the tab that leads, for each organisation
 * where the account is admin, once its region caught up, under one lock across the tabs, written
 * into that organisation whichever is current, and never over a row the region holds already.
 */

const membership = (key: string, role: Membership['role']): Membership => ({
  tenant: { id: tenantIdFactory.create(), key, name: key },
  role,
})

const acme = membership('acme', CONTRACT_ROLES.admin)
const globex = membership('globex', CONTRACT_ROLES.admin)
const initech = membership('initech', CONTRACT_ROLES.member)

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [acme, globex, initech],
}

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A leading engine whose `caughtUp` answers as `pulled` says, for every region it is asked about. */
function engineOf(pulled: () => Promise<void>) {
  const asked: string[] = []
  const engine: SyncEngine = {
    start: () => {},
    stop: () => {},
    visibility: () => {},
    localWrite: () => {},
    settled: () => Promise.resolve(),
    caughtUp: (region) => {
      asked.push(region)

      return pulled()
    },
    signOut: () => Promise.resolve('offline'),
    channelStopped: () => false,
  }

  return { engine, asked }
}

/** A tab of Ann's browser, offline, with every organisation's database open. */
async function tab(shared: {
  storage: ReturnType<typeof memoryStorage>
  locks?: FakeLocks
  databases?: ReturnType<typeof browserDatabases>
}) {
  const world = await openTestWorld({
    storage: shared.storage,
    online: false,
    ...(shared.locks ? { locks: shared.locks } : {}),
    ...(shared.databases ? { databases: shared.databases } : {}),
  })

  worlds.push(world)
  expect((await world.session.restore()).isOk()).toBe(true)

  return world
}

/** The deps of the starts of `world`, led by `engine` (none: a follower), its roles as `roles` says. */
function depsOf(
  world: TestWorld,
  engine: SyncEngine | undefined,
  locks: FakeLocks | undefined,
  roles: () => readonly Membership[] = () => world.session.space()?.memberships() ?? [],
): OrganisationStartsDeps {
  return {
    session: world.session,
    space: () => {
      const space = world.session.space()

      return (
        space && {
          identity: space.identity,
          sync: engine,
          memberships: roles,
          tenant: (key: string) => space.tenant(key),
        }
      )
    },
    clock: world.clock,
    locks,
    logger: { warn: () => {} },
    commandsFor: (key, admitted) =>
      createCommandBus({
        writePath: world.session.tenantWritePath(key, admitted),
        session: world.session,
        deviceId: 'device-test',
        logger: { info: () => {}, warn: () => {} },
        events: { publish: () => okAsync(undefined) },
      }),
  }
}

/** The settings rows the organisation `key`'s database holds on `world`'s device. */
async function rowsOf(world: TestWorld, key: string) {
  const view = world.session.space()?.tenant(key) ?? expect.unreachable(`${key} open`)

  expect((await view.flush()).isOk()).toBe(true)

  return (
    await view.runner.read(organisationSettingsShape, { id: organisationSettingsIdOf(key) })
  )._unsafeUnwrap()
}

describe('organisationStarts', () => {
  it("creates the one row of each admin's organisation once its region caught up, whichever is current", async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const world = await tab({ storage })
    const { engine, asked } = engineOf(() => Promise.resolve())

    organisationStarts(depsOf(world, engine, undefined)).syncState({ leader: true, channel: 'up' })

    await expect.poll(async () => (await rowsOf(world, 'globex')).length).toBe(1)
    expect(await rowsOf(world, 'acme')).toEqual([{ id: organisationSettingsIdOf('acme') }])
    expect(await rowsOf(world, 'initech')).toEqual([])
    expect(asked.sort()).toEqual([tenantRegionId('acme'), tenantRegionId('globex')])
  })

  it('creates nothing while the region has not caught up', async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const world = await tab({ storage })
    const { engine } = engineOf(() => new Promise(() => {}))

    organisationStarts(depsOf(world, engine, undefined)).syncState({ leader: true, channel: 'up' })
    await settle()

    expect(await rowsOf(world, 'acme')).toEqual([])
  })

  it('creates nothing in a tab that follows', async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const world = await tab({ storage })

    organisationStarts(depsOf(world, undefined, undefined)).syncState({
      leader: false,
      channel: 'up',
    })
    await settle()

    expect(await rowsOf(world, 'acme')).toEqual([])
  })

  it('keeps a row the region holds already, with its language, and creates no other', async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const world = await tab({ storage })
    const id = organisationSettingsIdOf('acme')
    const deps = depsOf(world, engineOf(() => Promise.resolve()).engine, undefined)

    expect(
      (
        await deps
          .commandsFor('acme', () => true)
          .execute(organisationSettingsCommands.createOrganisationSettings, { id })
      ).isOk(),
    ).toBe(true)
    expect(
      (
        await deps
          .commandsFor('acme', () => true)
          .execute(organisationSettingsCommands.updateLocale, { id, locale: 'es' })
      ).isOk(),
    ).toBe(true)

    organisationStarts(deps).syncState({ leader: true, channel: 'up' })
    await expect.poll(async () => (await rowsOf(world, 'globex')).length).toBe(1)

    expect(await rowsOf(world, 'acme')).toEqual([{ id, locale: 'es' }])
  })

  it('tries again after a catch-up that failed', async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const world = await tab({ storage })
    let failing = true
    const { engine, asked } = engineOf(() => {
      if (failing) {
        failing = false

        return Promise.reject(new Error('not yet'))
      }

      return Promise.resolve()
    })

    organisationStarts(depsOf(world, engine, undefined)).syncState({ leader: true, channel: 'up' })

    await expect.poll(async () => (await rowsOf(world, 'acme')).length).toBe(1)
    expect(
      asked.filter((region) => region === tenantRegionId('acme')).length,
    ).toBeGreaterThanOrEqual(1)
    expect(START_RETRY_MS).toBeGreaterThan(0)
  })

  it('writes nothing when the role was taken away between the catch-up and the write', async () => {
    const storage = memoryStorage()

    signedIn(storage, ann)

    const world = await tab({ storage })
    let admin = true
    const roles = () => (admin ? [acme] : [{ ...acme, role: CONTRACT_ROLES.member }])
    const { engine } = engineOf(async () => {
      admin = false
    })

    organisationStarts(depsOf(world, engine, undefined, roles)).syncState({
      leader: true,
      channel: 'up',
    })
    await settle()
    await settle()

    expect(await rowsOf(world, 'acme')).toEqual([])
  })

  it("lets one tab create the row at a time: a second leader reads the first one's row and creates none", async () => {
    const storage = memoryStorage()
    const locks = new FakeLocks()
    const databases = browserDatabases()

    signedIn(storage, { ...ann, memberships: [acme] })

    const a = await tab({ storage, locks, databases })
    const b = await tab({ storage, locks, databases })
    const caught = () => Promise.resolve()

    organisationStarts(depsOf(a, engineOf(caught).engine, locks)).syncState({
      leader: true,
      channel: 'up',
    })
    organisationStarts(depsOf(b, engineOf(caught).engine, locks)).syncState({
      leader: true,
      channel: 'up',
    })

    await expect.poll(async () => (await rowsOf(a, 'acme')).length).toBe(1)
    await expect.poll(async () => (await rowsOf(b, 'acme')).length).toBe(1)
    await settle()

    expect(await rowsOf(a, 'acme')).toEqual([{ id: organisationSettingsIdOf('acme') }])
    expect(await rowsOf(b, 'acme')).toEqual([{ id: organisationSettingsIdOf('acme') }])
  })
})
