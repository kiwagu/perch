/**
 * The gateway's composition root: the only module of the gateway that opens the central
 * database and builds the services over it.
 */

import type { ResultAsync } from 'neverthrow'

import {
  createAuth,
  type DataError,
  type Engines,
  type LocalDb,
  openLocalDb,
} from '@workspace/data'
import { readSchema } from '@workspace/data/schema-files'
import { replicaSchema } from '@workspace/database/replica-schema'
import { createLogger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'
import { RegionHub } from '@workspace/replica/server'

import { IdentitySessions } from '../auth/identity-sessions'
import { DIRECTORY, NAMESPACE } from '../config'

export interface GatewayRoot {
  readonly sessions: IdentitySessions
  readonly hub: RegionHub
  readonly local: LocalDb
  readonly clock: Clock
  /** Drops the hub's regions once their work is done, then closes the database. */
  close(): Promise<void>
}

export interface GatewayRootOptions {
  /** Engines from `@workspace/data/engines/remote`, or embedded ones in tests. */
  readonly engines: Engines
  /** The database's WebSocket endpoint: auth sessions are not available over HTTP. */
  readonly url: string
  /** The gateway's namespace user; an embedded database needs none. */
  readonly credentials?: { readonly username: string; readonly password: string }
  /** The database's RPC endpoint over HTTP, where refresh grants are revoked. */
  readonly rpcUrl: string
  readonly clock: Clock
}

export function createGatewayRoot(
  options: GatewayRootOptions,
): ResultAsync<GatewayRoot, DataError> {
  const hubLog = createLogger('region-hub')
  const sessionsLog = createLogger('identity-sessions')

  return openLocalDb({
    engines: options.engines,
    url: options.url,
    namespace: NAMESPACE,
    database: DIRECTORY,
    schema: readSchema(),
    ...(options.credentials
      ? { credentials: { ...options.credentials, namespace: NAMESPACE } }
      : {}),
  }).map((local): GatewayRoot => {
    const hub = new RegionHub({
      local,
      schema: replicaSchema,
      clock: options.clock,
      onError: (error) => hubLog.error({ code: error.code }, error.message),
    })

    return {
      sessions: new IdentitySessions({
        openAuth: () =>
          createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
        rpcUrl: options.rpcUrl,
        fetch,
        onCloseFailure: (error) => sessionsLog.warn({ code: error.code }, error.message),
      }),
      hub,
      local,
      clock: options.clock,
      close: async () => {
        await hub.close()
        await local.close()
      },
    }
  })
}
