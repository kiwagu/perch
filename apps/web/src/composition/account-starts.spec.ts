import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError, type LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { identityIdFactory } from '@workspace/ids'
import { privateRegionId } from '@workspace/replica'
import { CADENCE_MS, type SyncEngine } from '@workspace/replica/sync'
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
import { VerifyEmailService } from '../features/user/application/verify-email.service'
import {
  profileCommands,
  profileShape,
} from '../features/user/presentation/pages/profile/profile.model.gen'
import type { CommandsPort } from '../platform/commands.port'

import { fakeGatewayAuth, verifiedElsewhere } from './__fixtures__/gateway-auth'
import { browserDatabases, openTestWorld, type TestWorld } from './__fixtures__/session'
import { signedIn } from './__fixtures__/signed-in'
import {
  ACCOUNT_START_LOCK,
  type AccountStarts,
  accountStarts,
  accountStartTurns,
  START_RETRY_MS,
} from './account-starts'
import type { GatewayAuth } from './gateway-auth'
import { type KeptDevice, keptAccountStart, memoryStorage } from './storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const annStart: AccountStart = {
  identity: ann.identity.id,
  name: 'Ann',
  locale: 'es',
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

  const session = signedIn(storage, ann)

  const a = await openTestWorld({ storage, locks, databases, online: false })

  worlds.push(a)
  expect((await a.session.restore()).isOk()).toBe(true)

  const b = await openTestWorld({ storage, locks, databases, online: false, gateway: a.gateway })

  worlds.push(b)
  expect((await b.session.restore()).isOk()).toBe(true)

  return { a, b, storage, locks, session }
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
    const { a, b, storage, locks, session } = await twoTabs()
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
      () => 'system',
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
      () => 'system',
    )

    keptAccountStart(storage).keep(session.signIn, annStart)

    // Both tabs finish the start this browser kept at once, as one leading tab hands over to another.
    const resumingA = startsOfA.resumeAfterPull(ann.identity)
    const resumingB = startsOfB.resumeAfterPull(ann.identity)

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
      { id, locale: 'en', theme: 'system' },
    ])
    expect((await ofB.profiles.read({ identity: ann.identity.id }))._unsafeUnwrap()).toHaveLength(1)
    expect(keptAccountStart(storage).kept(ann.identity.id)).toBeUndefined()
  })

  it("keeps a start another tab still has to finish when one tab's session closes", async () => {
    const { a, storage, locks, session } = await twoTabs()
    const ofA = servicesOf(a)
    const another = identityIdFactory.create()

    accountStarts({
      session: a.session,
      space: () => a.session.space(),
      runner: a.session.runner,
      commands: a.commands,
      settings: ofA.settings,
      theme: () => 'system',
      storage,
      locks,
      clock: a.clock,
      logger: { warn: () => {} },
    })
    // Tab B's start, which tab B is still to finish.
    keptAccountStart(storage).keep(session.signIn, { ...annStart, identity: another })

    await a.session.close()

    expect(keptAccountStart(storage).kept(another)).toBeDefined()
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
      /** Wraps the browser's database, e.g. to make a write fail. */
      readonly wrap?: (local: LocalDb) => LocalDb
      /** The Web Locks the starts take their turns under; none by default. */
      readonly locks?: FakeLocks
      /** The gateway is out of reach until the spec brings the device's channel up. */
      readonly offline?: boolean
    } = {},
  ) {
    const tab: { starts?: AccountStarts } = {}
    const world = await openTestWorld({
      auth,
      ...(gateway ? { gateway } : {}),
      ...(options.wrap ? { wrap: options.wrap } : {}),
      ...(options.offline ? { online: false, network: true } : {}),
      keepAccountStart: (signIn, user, from) => tab.starts?.keepAfterPull(signIn, user, from),
      onSyncState: (state) => tab.starts?.syncState(state),
    })

    worlds.push(world)

    const services = servicesOf(world)
    const commands = options.commands ? options.commands(world.commands) : world.commands

    tab.starts = accountStarts({
      session: world.session,
      space: () => world.session.space(),
      runner: world.session.runner,
      commands,
      settings: new SettingsService(world.session.runner, commands, {
        shape: settingsShape,
        commands: settingsCommands,
      }),
      theme: () => 'system',
      storage: world.storage,
      locks: options.locks,
      clock: world.clock,
      logger: {
        warn: (entry) => {
          options.logged?.push(`${String(entry['event'])}: ${String(entry['outcome'])}`)
        },
      },
    })

    return { world, ...services }
  }

  /** The commands of a tab, each creation of the account's settings or profile noted in `created`. */
  const noting =
    (created: string[]) =>
    (own: CommandsPort): CommandsPort => ({
      execute: (command, params) => {
        if (
          command.id === settingsCommands.createSettings.id ||
          command.id === profileCommands.createProfile.id
        ) {
          created.push(command.id)
        }

        return own.execute(command, params)
      },
    })

  it('creates the settings and the profile once the device pulled what the account has: nothing', async () => {
    const { auth, signUp } = await annElsewhere()
    const { world, settings, profiles } = await browser(auth)
    const user = (await world.session.signIn(signUp))._unsafeUnwrap()

    await vi.waitFor(() => expect(keptAccountStart(world.storage).kept(user.id)).toBeUndefined())
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
    await vi.waitFor(() =>
      expect(keptAccountStart(first.world.storage).kept(user.id)).toBeUndefined(),
    )

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
    await vi.waitFor(() =>
      expect(keptAccountStart(second.world.storage).kept(user.id)).toBeUndefined(),
    )

    // Its start found both records pulled: the change stands, and there is one of each.
    expect((await second.settings.read({ identity: user.id }))._unsafeUnwrap()).toEqual([
      { id: row?.id, locale: 'en', theme: 'system' },
    ])
    expect((await second.profiles.read({ identity: user.id }))._unsafeUnwrap()).toHaveLength(1)
  })

  it('creates nothing on the browser a first verification signed in over what another browser started and changed while its answer was on its way', async () => {
    const auth = fakeGatewayAuth()
    const signUp = { email: 'ann@example.test', password: 'Secret-ann1', name: 'Ann', locale: 'es' }

    expect((await auth.signUp(signUp)).isOk()).toBe(true)

    // The gateway verifies the email at once; its answer reaches the browser when the spec says.
    let answer = () => {}
    const answered = new Promise<void>((resolve) => {
      answer = resolve
    })
    const held: GatewayAuth = {
      ...auth,
      verifyEmail: (link, device) =>
        auth
          .verifyEmail(link, device)
          .andThen((verified) => ResultAsync.fromSafePromise(answered).map(() => verified)),
    }
    // Until a start reaches the gateway, a sign-in answers that the account has not started.
    const starting: GatewayAuth = {
      ...auth,
      signIn: (input, device) =>
        auth
          .signIn(input, device)
          .map((signed) => ({ ...signed, start: { name: 'Ann', locale: 'es' as const } })),
    }
    const created: string[] = []
    // The verifying browser reaches the gateway only once the spec lets it.
    const verifying = await browser(held, undefined, { offline: true, commands: noting(created) })
    const verification = new VerifyEmailService(verifying.world.session).verify(
      auth.linkFor(signUp.email),
    )

    // Meanwhile another browser signs in, starts the account, changes its language, syncs it all.
    const other = await browser(starting, verifying.world.gateway)
    const user = (await other.world.session.signIn(signUp))._unsafeUnwrap()

    await vi.waitFor(() =>
      expect(keptAccountStart(other.world.storage).kept(user.id)).toBeUndefined(),
    )

    const [row] = (await other.settings.read({ identity: user.id }))._unsafeUnwrap()
    const id = row?.id ?? expect.unreachable('settings')

    expect((await other.settings.updateLocale({ id, locale: 'en' })).isOk()).toBe(true)
    await (other.world.session.space()?.sync ?? expect.unreachable('it leads')).settled(30_000)

    // The verification's answer arrives: the browser is signed in, and creates nothing yet.
    answer()
    expect((await verification)._unsafeUnwrap()).toMatchObject({ kind: 'signed-in', user })
    expect(created).toEqual([])

    // Once it reaches the gateway it pulls what the other browser made, and creates nothing.
    for (const transport of verifying.world.transports()) {
      transport.goOnline()
    }

    await vi.waitFor(() =>
      expect(keptAccountStart(verifying.world.storage).kept(user.id)).toBeUndefined(),
    )
    expect(created).toEqual([])
    expect((await verifying.settings.read({ identity: user.id }))._unsafeUnwrap()).toEqual([
      { id, locale: 'en', theme: 'system' },
    ])
    expect((await verifying.profiles.read({ identity: user.id }))._unsafeUnwrap()).toHaveLength(1)
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
    expect(keptAccountStart(world.storage).kept(user.id)).toMatchObject({ identity: user.id })
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toEqual([])

    await world.clock.advance(START_RETRY_MS)

    await vi.waitFor(() => expect(keptAccountStart(world.storage).kept(user.id)).toBeUndefined())
    expect((await profiles.read({ identity: user.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann' },
    ])
    expect(logged).toEqual(['account-start: data:WRITE_FAILED'])
  })

  it('creates nothing while the pull of the private region failed to import, and starts the account once it recovered', async () => {
    const { auth, signUp } = await annElsewhere()
    const first = await browser(auth)
    const user = (await first.world.session.signIn(signUp))._unsafeUnwrap()

    // The first device starts the account and changes its language; the gateway holds both.
    await vi.waitFor(() =>
      expect(keptAccountStart(first.world.storage).kept(user.id)).toBeUndefined(),
    )

    const [row] = (await first.settings.read({ identity: user.id }))._unsafeUnwrap()
    const id = row?.id ?? expect.unreachable('settings')

    expect((await first.settings.updateLocale({ id, locale: 'en' })).isOk()).toBe(true)
    await (first.world.session.space()?.sync ?? expect.unreachable('it leads')).settled(30_000)

    // The second device cannot store what the gateway sends it: every import of its pull fails.
    // Its starts take their turns under a lock the spec holds until it looks.
    const store = { refusing: true }
    const locks = new FakeLocks()
    let release = () => {}

    void locks.request(
      ACCOUNT_START_LOCK,
      { mode: 'exclusive' },
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    const second = await browser(auth, first.world.gateway, {
      locks,
      wrap: (local) =>
        interceptQueries(local, (text) => {
          // The statement that stores a server update: it writes an update, and no outbox row.
          const storesServerUpdate =
            text.includes('_replica_update SET') && !text.includes('_replica_outbox')

          if (store.refusing && storesServerUpdate) {
            throw new Error('the store refused the update')
          }
        }),
    })

    expect((await second.world.session.signIn(signUp)).isOk()).toBe(true)

    const engine = second.world.session.space()?.sync ?? expect.unreachable('it leads')

    // Its engine settles all the same: the answer and the answer to its recovery were handled.
    await engine.settled(30_000)
    await engine.settled(30_000)

    expect(second.world.failures.map(({ code }) => code)).toContain('data:WRITE_FAILED')

    // Every start that began by now takes its turn, then the spec takes one after them all.
    release()
    await new Promise<void>((resolve) => {
      void locks.request(ACCOUNT_START_LOCK, { mode: 'exclusive' }, async () => resolve())
    })

    expect(keptAccountStart(second.world.storage).kept(user.id)).toMatchObject({
      identity: user.id,
    })
    expect((await second.settings.read({ identity: user.id }))._unsafeUnwrap()).toEqual([])
    expect((await second.profiles.read({ identity: user.id }))._unsafeUnwrap()).toEqual([])

    // The store takes writes again; a full pass subscribes afresh and the pull imports in full.
    store.refusing = false
    second.world.failures.splice(0)
    await second.world.clock.advance(CADENCE_MS.full)

    await vi.waitFor(() =>
      expect(keptAccountStart(second.world.storage).kept(user.id)).toBeUndefined(),
    )
    expect((await second.settings.read({ identity: user.id }))._unsafeUnwrap()).toEqual([
      { id, locale: 'en', theme: 'system' },
    ])
    expect((await second.profiles.read({ identity: user.id }))._unsafeUnwrap()).toHaveLength(1)
  })
})

describe("a start that waits for the pull, by its engine's word", () => {
  /** A leading engine whose `settled` answers at once and whose `caughtUp` answers as `pulled` says. */
  function engineOf(pulled: { caughtUp: Promise<void> }) {
    const asked: string[] = []
    const engine: SyncEngine = {
      start: () => {},
      stop: () => {},
      visibility: () => {},
      localWrite: () => {},
      settled: () => Promise.resolve(),
      caughtUp: (region) => {
        asked.push(region)

        return pulled.caughtUp
      },
      signOut: () => Promise.resolve('offline'),
      channelStopped: () => false,
    }

    return { engine, asked }
  }

  /** Ann's browser offline, its starts led by `engine`; a start waits for the pull. */
  async function ledBy(engine: SyncEngine) {
    const storage = memoryStorage()
    const session = signedIn(storage, ann)

    const world = await openTestWorld({ storage, online: false })

    worlds.push(world)
    expect((await world.session.restore()).isOk()).toBe(true)

    const services = servicesOf(world)
    const starts = accountStarts({
      session: world.session,
      space: () => ({ identity: ann.identity, sync: engine }),
      runner: world.session.runner,
      commands: world.commands,
      settings: services.settings,
      theme: () => 'system',
      storage,
      locks: undefined,
      clock: world.clock,
      logger: { warn: () => {} },
    })

    keptAccountStart(storage).keep(session.signIn, annStart)
    starts.syncState({ leader: true, channel: 'up' })

    return { world, storage, session, ...services }
  }

  it('creates nothing while its private region has not caught up, as one stopped or left out of the welcome never does', async () => {
    const { engine, asked } = engineOf({ caughtUp: new Promise(() => {}) })
    const { storage, session, settings, profiles } = await ledBy(engine)

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    expect(asked).toEqual([privateRegionId(ann.identity.id)])
    expect(keptAccountStart(storage).kept(ann.identity.id)).toEqual({
      ...annStart,
      signIn: session.signIn,
    })
    expect((await settings.read({ identity: ann.identity.id }))._unsafeUnwrap()).toEqual([])
    expect((await profiles.read({ identity: ann.identity.id }))._unsafeUnwrap()).toEqual([])
  })

  it('starts the account once its private region caught up', async () => {
    let caughtUp = () => {}
    const pulled = {
      caughtUp: new Promise<void>((resolve) => {
        caughtUp = resolve
      }),
    }
    const { engine } = engineOf(pulled)
    const { storage, profiles } = await ledBy(engine)

    caughtUp()

    await vi.waitFor(() => expect(keptAccountStart(storage).kept(ann.identity.id)).toBeUndefined())
    expect((await profiles.read({ identity: ann.identity.id }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann' },
    ])
  })
})
