import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'
import { FakeLocks } from '@workspace/replica/testing'

import {
  type AccountStart,
  AccountStartService,
} from '../features/user/application/account-start.service'
import { ProfileService } from '../features/user/application/profile.service'
import {
  settingsCommands,
  settingsShape,
} from '../features/user/application/settings/settings.model.gen'
import {
  type NewSettings,
  SettingsService,
} from '../features/user/application/settings/settings.service'
import {
  profileCommands,
  profileShape,
} from '../features/user/presentation/pages/profile/profile.model.gen'
import type { CommandsPort } from '../platform/commands.port'

import { fakeGatewayAuth, verifiedElsewhere } from './__fixtures__/gateway-auth'
import { browserDatabases, openTestWorld, type TestWorld } from './__fixtures__/session'
import {
  type AccountStarts,
  accountStarts,
  accountStartTurns,
  START_RETRY_MS,
} from './account-starts'
import type { GatewayAuth } from './gateway-auth'
import { type KeptDevice, keptAccountStart, memoryStorage, saveDevice } from './storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const annStart: AccountStart = {
  identity: ann.identity.id,
  name: 'Ann',
  locale: 'es',
  afterPull: false,
}

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

/**
 * Two tabs of one browser signed in to Ann: one storage, one set of databases, one lock manager,
 * and a region document each; neither hears the other's writes until it reads the database.
 */
async function twoTabs() {
  const storage = memoryStorage()
  const locks = new FakeLocks()
  const databases = browserDatabases()

  saveDevice(storage, ann)

  const a = await openTestWorld({ storage, locks, databases, online: false })

  worlds.push(a)
  expect((await a.session.restore()).isOk()).toBe(true)

  const b = await openTestWorld({ storage, locks, databases, online: false, gateway: a.gateway })

  worlds.push(b)
  expect((await b.session.restore()).isOk()).toBe(true)

  return { a, b, storage, locks }
}

/** The settings and profile services of a tab. */
function servicesOf(tab: TestWorld) {
  return {
    settings: new SettingsService(tab.session.runner, tab.commands, {
      shape: settingsShape,
      commands: settingsCommands,
    }),
    profiles: new ProfileService(tab.session.runner, tab.commands, {
      shape: profileShape,
      commands: profileCommands,
    }),
  }
}

describe('the account starts of a browser', () => {
  it("lets one tab start an account at a time: a tab's late recovery creates nothing over what another created and edited", async () => {
    const { a, b, storage, locks } = await twoTabs()
    const ofA = servicesOf(a)
    const ofB = servicesOf(b)
    const created: NewSettings[] = []
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const startsOfA = new AccountStartService(
      ofA.profiles,
      ofA.settings,
      keptAccountStart(storage),
      accountStartTurns(locks, () => a.session.flush()),
    )
    // Tab B's creation of the settings is late: it goes through only once tab A edited them.
    const startsOfB = new AccountStartService(
      ofB.profiles,
      {
        read: (owner) => ofB.settings.read(owner),
        createSettings: (settings) => {
          created.push(settings)

          return ResultAsync.fromSafePromise(held).andThen(() =>
            ofB.settings.createSettings(settings),
          )
        },
      },
      keptAccountStart(storage),
      accountStartTurns(locks, () => b.session.flush()),
    )

    keptAccountStart(storage).keep(annStart)

    // Both tabs open Ann's space at once and resume the start this browser kept.
    const resumingA = startsOfA.resume(ann.identity)
    const resumingB = startsOfB.resume(ann.identity)

    expect((await resumingA).isOk()).toBe(true)

    const [settings] = (await ofA.settings.read({ identity: ann.identity.id }))._unsafeUnwrap()
    const id = settings?.id ?? expect.unreachable('settings')

    expect((await ofA.settings.updateLocale({ id, locale: 'en' })).isOk()).toBe(true)
    expect((await a.session.flush()).isOk()).toBe(true)
    release()
    await held
    expect((await resumingB).isOk()).toBe(true)

    // No second container under the settings' key: the edit stands.
    expect(created).toEqual([])
    expect((await b.session.flush()).isOk()).toBe(true)
    expect((await ofA.settings.read({ identity: ann.identity.id }))._unsafeUnwrap()).toEqual([
      { id, locale: 'en' },
    ])
    expect((await ofB.profiles.read({ identity: ann.identity.id }))._unsafeUnwrap()).toHaveLength(1)
    expect(keptAccountStart(storage).kept()).toBeUndefined()
  })

  it("keeps a start another tab still has to finish when one tab's session closes", async () => {
    const { a, storage, locks } = await twoTabs()
    const ofA = servicesOf(a)

    accountStarts({
      session: a.session,
      space: () => a.session.space(),
      runner: a.session.runner,
      commands: a.commands,
      settings: ofA.settings,
      storage,
      locks,
      clock: a.clock,
      logger: { warn: () => {} },
    })
    // Tab B's start, which tab B is still to finish.
    keptAccountStart(storage).keep({ ...annStart, identity: identityIdFactory.create() })

    await a.session.close()

    expect(keptAccountStart(storage).kept()).toBeDefined()
  })

  it('projects what this tab pulled before the start reads, hands it that flush, and flushes its writes after', async () => {
    const steps: string[] = []
    const flush = () => {
      steps.push('flush')

      return okAsync(undefined)
    }
    const turns = accountStartTurns(new FakeLocks(), flush)

    expect(
      (
        await turns((projected) => {
          steps.push('read')

          return projected().map(() => 'ran')
        })
      )._unsafeUnwrap(),
    ).toBe('ran')
    expect(steps).toEqual(['flush', 'read', 'flush', 'flush'])
  })

  it('runs no start whose reads would miss what was pulled: the projection failed', async () => {
    const run = vi.fn(() => okAsync('ran'))
    const turns = accountStartTurns(new FakeLocks(), () =>
      errAsync(dataError('data:WRITE_FAILED', 'not projected')),
    )

    expect((await turns(run))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(run).not.toHaveBeenCalled()
  })

  it("fails a turn whose writes could not be flushed for the next tab, and keeps a start's own failure", async () => {
    let flushes = 0
    // The flush before the start goes through; the one after it does not.
    const unflushedAfter = () => {
      flushes += 1

      return flushes % 2 === 1
        ? okAsync(undefined)
        : errAsync(dataError('data:WRITE_FAILED', 'not projected'))
    }
    const turns = accountStartTurns(new FakeLocks(), unflushedAfter)

    expect((await turns(() => okAsync('ran')))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(
      (await turns(() => errAsync(dataError('data:OFFLINE', 'offline'))))._unsafeUnwrapErr().code,
    ).toBe('data:OFFLINE')
  })

  it('runs a turn at once in a browser without Web Locks', async () => {
    const flush = vi.fn(() => okAsync(undefined))

    expect((await accountStartTurns(undefined, flush)(() => okAsync('ran')))._unsafeUnwrap()).toBe(
      'ran',
    )
    expect(flush).toHaveBeenCalledTimes(2)
  })
})

describe('a start a sign-in learnt of', () => {
  /** Ann's account at the gateway, verified on a device that never synced its start. */
  async function annElsewhere() {
    const auth = fakeGatewayAuth()
    const signUp = { email: 'ann@example.test', password: 'Secret-ann1', name: 'Ann', locale: 'es' }

    expect((await verifiedElsewhere(auth, signUp)).isOk()).toBe(true)

    // Her account has no settings or profile at the gateway: each sign-in answers its start.
    const starting: GatewayAuth = {
      ...auth,
      signIn: (input, device) =>
        auth
          .signIn(input, device)
          .map((signed) => ({ ...signed, start: { name: 'Ann', locale: 'es' as const } })),
    }

    return { auth: starting, signUp }
  }

  /**
   * A browser that signs in through `auth`, sharing `gateway` when given one, its starts wired as
   * the root wires them: the sign-in keeps a start, the leading tab finishes it after its pull.
   */
  async function browser(
    auth: GatewayAuth,
    gateway?: TestWorld['gateway'],
    options: {
      /** The commands the starts run, over the world's own. */
      readonly commands?: (own: CommandsPort) => CommandsPort
      readonly logged?: string[]
    } = {},
  ) {
    const tab: { starts?: AccountStarts } = {}
    const world = await openTestWorld({
      auth,
      ...(gateway ? { gateway } : {}),
      keepAccountStart: (user, from) => tab.starts?.keepAfterPull(user, from),
      onSyncState: (state) => tab.starts?.syncState(state),
    })

    worlds.push(world)

    const services = servicesOf(world)

    tab.starts = accountStarts({
      session: world.session,
      space: () => world.session.space(),
      runner: world.session.runner,
      commands: options.commands ? options.commands(world.commands) : world.commands,
      settings: services.settings,
      storage: world.storage,
      locks: undefined,
      clock: world.clock,
      logger: {
        warn: (entry) => {
          options.logged?.push(`${String(entry['event'])}: ${String(entry['outcome'])}`)
        },
      },
    })

    return { world, ...services }
  }

  it('creates the settings and the profile once the device pulled what the account has: nothing', async () => {
    const { auth, signUp } = await annElsewhere()
    const { world, settings, profiles } = await browser(auth)
    const user = (await world.session.signIn(signUp))._unsafeUnwrap()

    await vi.waitFor(() => expect(keptAccountStart(world.storage).kept()).toBeUndefined())
    expect((await settings.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { locale: 'es' },
    ])
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: 'ann@example.test' },
    ])
  })

  it('creates nothing over what another device started and changed before this one pulled it', async () => {
    const { auth, signUp } = await annElsewhere()
    const first = await browser(auth)
    const user = (await first.world.session.signIn(signUp))._unsafeUnwrap()

    // The first device starts the account, then changes its language, and syncs it all.
    await vi.waitFor(() => expect(keptAccountStart(first.world.storage).kept()).toBeUndefined())

    const [row] = (await first.settings.read({ identity: user.id }))._unsafeUnwrap()

    expect(
      (
        await first.settings.updateLocale({
          id: row?.id ?? expect.unreachable('settings'),
          locale: 'en',
        })
      ).isOk(),
    ).toBe(true)
    await (first.world.session.space()?.sync ?? expect.unreachable('it leads')).settled(30_000)

    // The second device signs in while the gateway still answers that the account has not started.
    const second = await browser(auth, first.world.gateway)

    expect((await second.world.session.signIn(signUp)).isOk()).toBe(true)
    await vi.waitFor(() => expect(keptAccountStart(second.world.storage).kept()).toBeUndefined())

    // Its start found both records pulled: the change stands, and there is one of each.
    expect((await second.settings.read({ identity: user.id }))._unsafeUnwrap()).toEqual([
      { id: row?.id, locale: 'en' },
    ])
    expect((await second.profiles.read({ identity: user.id }))._unsafeUnwrap()).toHaveLength(1)
  })

  it('tries a start that failed after the pull again on the same engine, once its wait is over', async () => {
    const { auth, signUp } = await annElsewhere()
    const logged: string[] = []
    let refuseProfile = true
    const { world, profiles } = await browser(auth, undefined, {
      logged,
      // The first creation of the profile fails, as a write that did not go through.
      commands: (own) => ({
        execute: (command, params) => {
          if (command.id === profileCommands.createProfile.id && refuseProfile) {
            refuseProfile = false

            return errAsync({ code: 'data:WRITE_FAILED', message: 'not written' })
          }

          return own.execute(command, params)
        },
      }),
    })
    const user = (await world.session.signIn(signUp))._unsafeUnwrap()

    await vi.waitFor(() => expect(logged).toEqual(['account-start: data:WRITE_FAILED']))
    expect(keptAccountStart(world.storage).kept()).toMatchObject({ afterPull: true })
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toEqual([])

    await world.clock.advance(START_RETRY_MS)

    await vi.waitFor(() => expect(keptAccountStart(world.storage).kept()).toBeUndefined())
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann' },
    ])
    expect(logged).toEqual(['account-start: data:WRITE_FAILED'])
  })
})
