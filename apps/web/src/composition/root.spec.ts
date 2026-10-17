import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { type DataError, dataError, SHAPE_RUNNER, WRITE_PATH } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { syncHints } from '@workspace/replica/sync'
import { FakeLocks, gatewayStub, manualClock } from '@workspace/replica/testing'

import { COMMANDS } from '../platform/commands.port'
import { SESSION } from '../platform/session.port'

import { fakeGatewayAuth } from './__fixtures__/gateway-auth'
import { type AppRootOptions, type AppServices, type BootStep, createAppRoot } from './root'
import { type MemoryStorage, memoryStorage, saveDevice } from './storage'

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
  openLocal?: AppRootOptions['openLocal'],
) {
  const server = (await openTestDb())._unsafeUnwrap()
  const clock = manualClock()
  const stub = gatewayStub({ local: server, schema: replicaSchema, clock })
  const opened: IdentityId[] = []

  cleanups.push(async () => {
    await stub.close()
    await server.close()
  })

  const result = await createAppRoot({
    openLocal:
      openLocal ??
      ((identity) => {
        opened.push(identity)

        return openTestDb()
      }),
    gatewayAuth: fakeGatewayAuth(),
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
    logger: { info: () => {}, warn: () => {} },
    onStep: (step) => steps.push(step),
    onError: (error) => failures.push(error),
    onSyncState: () => {},
  })

  return { result, opened }
}

const ann = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  tokens: { access: 'access-ann', refresh: 'refresh-ann' },
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
    expect(services.session.current()).toBeUndefined()
    expect(failures).toEqual([])
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

    const { result } = await boot(storage, steps, [], () =>
      errAsync(dataError('data:OPEN_FAILED', 'could not open the store')),
    )

    expect(result._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect(steps).toEqual(['restore-session', 'open-db'])
  })
})
