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

import { browserDatabases, openTestWorld, type TestWorld } from './__fixtures__/session'
import { accountStarts, accountStartTurns } from './account-starts'
import { type KeptDevice, keptAccountStart, memoryStorage, saveDevice } from './storage'

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

const annStart: AccountStart = { identity: ann.identity.id, name: 'Ann', locale: 'es' }

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
      runner: a.session.runner,
      commands: a.commands,
      settings: ofA.settings,
      storage,
      locks,
      logger: { warn: () => {} },
    })
    // Tab B's start, which tab B is still to finish.
    keptAccountStart(storage).keep({ ...annStart, identity: identityIdFactory.create() })

    await a.session.close()

    expect(keptAccountStart(storage).kept()).toBeDefined()
  })

  it("fails a turn whose writes could not be flushed for the next tab, and keeps a start's own failure", async () => {
    const unflushed = () => errAsync(dataError('data:WRITE_FAILED', 'not projected'))
    const turns = accountStartTurns(new FakeLocks(), unflushed)

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
    expect(flush).toHaveBeenCalledOnce()
  })
})
