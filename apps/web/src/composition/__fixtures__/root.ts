import { okAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import type { IdentityId } from '@workspace/ids'
import { syncHints } from '@workspace/replica/sync'
import { FakeLocks, gatewayStub, manualClock } from '@workspace/replica/testing'

import { devicesApi } from '../devices-api'
import { organisationsApi } from '../organisations-api'
import { type AppRootOptions, type BootStep, createAppRoot } from '../root'
import type { MemoryStorage } from '../storage'

import { fakeGatewayAuth } from './gateway-auth'

/**
 * Boots the app root on test databases and an offline gateway stub, the gateway routes never
 * reached: `steps` and `failures` collect what the start reports, `overrides` replace any option.
 * What the boot opened is closed by the function it pushes to `cleanups`. Gives the start's
 * outcome with its services, the identities whose databases opened, and the services themselves,
 * which exist whether the start succeeded or not.
 */
export async function bootRoot(
  cleanups: Array<() => Promise<void>>,
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

  return { result, opened, root: start.services }
}
