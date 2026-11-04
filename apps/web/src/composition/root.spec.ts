import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError, SHAPE_RUNNER, WRITE_PATH } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { syncHints } from '@workspace/replica/sync'
import { FakeLocks, gatewayStub, manualClock } from '@workspace/replica/testing'

import { ProfileService } from '../features/user/application/profile.service'
import { SETTINGS_SERVICE } from '../features/user/application/settings/settings.service'
import {
  profileCommands,
  profileShape,
} from '../features/user/presentation/pages/profile/profile.model.gen'
import { COMMANDS } from '../platform/commands.port'
import { DEVICES } from '../platform/devices.port'
import { ORGANISATIONS } from '../platform/organisations.port'
import { PLATFORM_EVENTS } from '../platform/platform-events.port'
import { SESSION } from '../platform/session.port'

import { fakeGatewayAuth } from './__fixtures__/gateway-auth'
import { fakeFetch, respond } from './__fixtures__/gateway-fetch'
import { signUpVerified } from './__fixtures__/session'
import { devicesApi } from './devices-api'
import type { BearerDeps } from './gateway-bearer'
import { organisationsApi } from './organisations-api'
import { type AppRootOptions, type AppServices, type BootStep, createAppRoot } from './root'
import {
  keptAccountStart,
  type MemoryStorage,
  memoryStorage,
  PASSWORD_RESET_KEY,
  saveDevice,
} from './storage'

let services: AppServices | undefined
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await services?.close()
  services = undefined

  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

async function boot(
  storage: MemoryStorage,
  steps: BootStep[],
  failures: DataError[],
  overrides: Partial<AppRootOptions> = {},
) {
  const server = (await openTestDb())._unsafeUnwrap()
  const clock = manualClock()
  const stub = gatewayStub({ local: server, schema: replicaSchema, clock })
  const opened: IdentityId[] = []

  cleanups.push(async () => {
    await stub.close()
    await server.close()
  })

  const start = createAppRoot({
    openLocal: (identity) => {
      opened.push(identity)

      return openTestDb()
    },
    deleteLocal: () => okAsync(undefined),
    openTenantLocal: () => openTestDb({ schema: readSchema('tenant'), database: 'tenant' }),
    deleteTenantLocal: () => okAsync(undefined),
    gatewayAuth: fakeGatewayAuth(),
    deviceLabel: 'Chrome on Linux',
    theme: () => 'system',
    online: () => false,
    onOnlineChange: () => () => {},
    organisationsApi: (deps) =>
      organisationsApi('/backend', {
        ...deps,
        fetcher: () => Promise.reject(new Error('the gateway is not reached in these tests')),
      }),
    devicesApi: (deps) =>
      devicesApi('/backend', {
        ...deps,
        fetcher: () => Promise.reject(new Error('the gateway is not reached in these tests')),
      }),
    transport: (context) => {
      const transport = stub.transport(context.identity)

      transport.goOffline()

      return transport
    },
    locks: new FakeLocks(),
    hints: () => syncHints(undefined),
    clock,
    storage,
    visibility: { current: () => 'visible', onChange: () => () => {} },
    servedBuild: { watch: () => () => {} },
    logger: { info: () => {}, warn: () => {} },
    onStep: (step) => steps.push(step),
    onError: (error) => failures.push(error),
    onSyncState: () => {},
    ...overrides,
  })
  const result = (await start.opened).map(() => start.services)

  return { result, opened }
}

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [],
}

describe('createAppRoot', () => {
  it('boots signed out without opening a database and binds every port to its token', async () => {
    const steps: BootStep[] = []
    const failures: DataError[] = []
    const { result, opened } = await boot(memoryStorage(), steps, failures)

    services = result._unsafeUnwrap()

    expect(steps).toEqual(['restore-session', 'ready'])
    expect(opened).toEqual([])
    expect(services.container.get(SHAPE_RUNNER)).toBe(services.runner)
    expect(services.container.get(WRITE_PATH)).toBe(services.writePath)
    expect(services.container.get(SESSION)).toBe(services.session)
    expect(services.container.get(COMMANDS)).toBe(services.commands)
    expect(services.container.get(ORGANISATIONS)).toBe(services.organisations)
    expect(services.container.get(DEVICES)).toBe(services.devices)
    expect(services.session.current()).toBeUndefined()
    expect(failures).toEqual([])
  })

  it("tells the screens a password reset another tab of the browser made, through the browser's storage", async () => {
    const storage = memoryStorage()
    const { result } = await boot(storage, [], [])

    services = result._unsafeUnwrap()

    const heard = vi.fn()

    services.container.get(PLATFORM_EVENTS).listen(heard)
    storage.changeElsewhere(PASSWORD_RESET_KEY, 'reset-elsewhere')

    expect(heard).toHaveBeenCalledWith({ type: 'platform.password-reset' })
  })

  it("opens the saved identity's database while it restores the session", async () => {
    const storage = memoryStorage()
    const steps: BootStep[] = []
    const failures: DataError[] = []

    saveDevice(storage, ann)

    const { result, opened } = await boot(storage, steps, failures)

    services = result._unsafeUnwrap()

    expect(steps).toEqual(['restore-session', 'open-db', 'ready'])
    expect(opened).toEqual([ann.identity.id])
    expect(services.session.current()).toEqual(ann.identity)
    expect(failures).toEqual([])
  })

  it('stops at the step that failed', async () => {
    const storage = memoryStorage()
    const steps: BootStep[] = []

    saveDevice(storage, ann)

    const { result } = await boot(storage, steps, [], {
      openLocal: () => errAsync(dataError('data:OPEN_FAILED', 'could not open the store')),
    })

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'open-failed',
      error: { code: 'data:OPEN_FAILED' },
    })
    expect(steps).toEqual(['restore-session', 'open-db'])
  })

  it('offers to sign out on this device when the saved identity does not open, which forgets it and deletes its database', async () => {
    const storage = memoryStorage()
    const deleted: IdentityId[] = []

    saveDevice(storage, ann)

    const { result } = await boot(storage, [], [], {
      openLocal: () => errAsync(dataError('data:OPEN_FAILED', 'could not open the store')),
      deleteLocal: (identity) => {
        deleted.push(identity)

        return okAsync(undefined)
      },
    })
    const failure = result._unsafeUnwrapErr()
    const signOutHere =
      failure.kind === 'open-failed' ? failure.signOutHere : expect.unreachable('open-failed')

    expect((await (signOutHere ?? expect.unreachable('offered'))()).isOk()).toBe(true)
    expect(storage.get('perch.session.identity')).toBeUndefined()
    expect(deleted).toEqual([ann.identity.id])
  })

  it('names this device to the gateway: at the verification with the label it is given, and on the organisation and device routes', async () => {
    const storage = memoryStorage()
    const auth = fakeGatewayAuth()
    let deps: BearerDeps | undefined
    let devicesDeps: BearerDeps | undefined
    // The verification reads the memberships through the organisation route.
    const organisationsFetch = fakeFetch(respond(200, { memberships: [] }))
    const { result } = await boot(storage, [], [], {
      gatewayAuth: auth,
      deviceLabel: 'Safari on iPhone',
      organisationsApi: (given) => {
        // The first is the routes' own, over the saved token; a sign-in's read names its token.
        deps ??= given

        return organisationsApi('/backend', { ...given, fetcher: organisationsFetch.fetcher })
      },
      devicesApi: (given) => {
        devicesDeps = given

        return devicesApi('/backend', {
          ...given,
          fetcher: () => Promise.reject(new Error('the gateway is not reached in these tests')),
        })
      },
    })

    services = result._unsafeUnwrap()

    const email = 'ann@example.test'

    expect(
      (
        await signUpVerified(services.session, auth, {
          email,
          password: 'Pass-word-1',
          name: 'Ann',
          locale: 'en',
        })
      ).isOk(),
    ).toBe(true)

    const id = storage.get('perch.device.id') ?? expect.unreachable('a device id')

    // The sign-up names no device: nothing is signed in until the link is opened.
    expect(auth.requests).toEqual([
      { kind: 'sign-up', email, name: 'Ann', locale: 'en' },
      { kind: 'verify', token: auth.linkFor(email), device: { id, label: 'Safari on iPhone' } },
    ])
    expect(deps?.device()).toBe(id)
    expect(devicesDeps?.device()).toBe(id)
    expect(deps?.token()).toBe(storage.get('perch.session.token'))
    expect(devicesDeps?.token()).toBe(deps?.token())
    // The memberships were read with the token the verification was given, naming this device.
    expect(organisationsFetch.sent).toEqual([
      {
        url: '/backend/organisations',
        method: 'GET',
        authorization: `Bearer ${deps?.token() ?? expect.unreachable('a token')}`,
        device: id,
        body: undefined,
      },
    ])
  })

  it("finishes, as the saved identity's space opens, the start of its account this browser kept, in the theme this device shows", async () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)
    // A first verification here created nothing yet when the page went.
    keptAccountStart(storage).keep({
      identity: ann.identity.id,
      name: 'Ann',
      locale: 'es',
      afterPull: false,
    })

    const { result } = await boot(storage, [], [], { theme: () => 'dark' })

    services = result._unsafeUnwrap()

    const profiles = new ProfileService(services.runner, services.commands, {
      shape: profileShape,
      commands: profileCommands,
    })
    const identity = ann.identity.id

    await vi.waitFor(() => expect(keptAccountStart(storage).kept()).toBeUndefined())
    expect((await services.session.flush()).isOk()).toBe(true)
    expect(
      (await services.container.get(SETTINGS_SERVICE).read({ identity }))._unsafeUnwrap(),
    ).toMatchObject([{ locale: 'es', theme: 'dark' }])
    expect((await profiles.read({ identity }))._unsafeUnwrap()).toMatchObject([
      { name: 'Ann', email: ann.identity.email },
    ])
  })

  it('keeps the kept start when the session merely closes: its tab goes, the browser stays signed in', async () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const { result } = await boot(storage, [], [])
    const booted = result._unsafeUnwrap()

    // Another tab's start, still to finish there.
    keptAccountStart(storage).keep({
      identity: identityIdFactory.create(),
      name: 'Bob',
      locale: 'en',
      afterPull: false,
    })
    await booted.close()

    expect(keptAccountStart(storage).kept()).toBeDefined()
  })

  it('forgets the kept start once this browser signs out, with the data it held', async () => {
    const storage = memoryStorage()

    saveDevice(storage, ann)

    const { result } = await boot(storage, [], [])

    services = result._unsafeUnwrap()
    // Kept for an account whose space this browser does not open: nothing finishes it here.
    keptAccountStart(storage).keep({
      identity: identityIdFactory.create(),
      name: 'Bob',
      locale: 'en',
      afterPull: false,
    })

    expect((await services.session.signOut())._unsafeUnwrap()).toBe('signed-out')
    expect(keptAccountStart(storage).kept()).toBeUndefined()
  })
})
