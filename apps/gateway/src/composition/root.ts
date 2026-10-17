/**
 * The gateway's composition root: the only module of the gateway that opens the central
 * database and the organisations' databases, and builds the services over them.
 */

import type { ResultAsync } from 'neverthrow'

import {
  createAuth,
  type DataError,
  type Engines,
  type LocalDb,
  openLocalDb,
  tenantDatabase,
} from '@workspace/data'
import { readSchema } from '@workspace/data/schema-files'
import { replicaSchema } from '@workspace/database/replica-schema'
import { createLogger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'
import { RegionHub } from '@workspace/replica/server'

import { IdentitySessions } from '../auth/identity-sessions'
import { DIRECTORY, NAMESPACE } from '../config'
import { ConnectionRegistry } from '../sync/connections'
import { Organisations } from '../tenants/organisations'
import { regionDatabases } from '../tenants/region-databases'
import { TenantDatabases } from '../tenants/tenant-databases'

export interface GatewayRoot {
  readonly sessions: IdentitySessions
  readonly organisations: Organisations
  /** The organisations' databases, each opened on first use. */
  readonly databases: TenantDatabases
  /**
   * The region hub: it keeps private regions in the directory and each tenant region in its
   * organisation's database.
   */
  readonly hub: RegionHub
  /** The open sync connections of each identity, told of every change of its memberships. */
  readonly connections: ConnectionRegistry
  /** The directory database. */
  readonly local: LocalDb
  readonly clock: Clock
  /**
   * Drops the hub's regions once their work is done, closes the organisations' databases, then
   * the directory.
   */
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
  const tenantsLog = createLogger('tenant-databases')
  const credentials = options.credentials
    ? { credentials: { ...options.credentials, namespace: NAMESPACE } }
    : {}
  const tenantSchema = readSchema('tenant')

  return openLocalDb({
    engines: options.engines,
    url: options.url,
    namespace: NAMESPACE,
    database: DIRECTORY,
    schema: readSchema('directory'),
    ...credentials,
  }).map((local): GatewayRoot => {
    const databases = new TenantDatabases({
      open: (key) =>
        openLocalDb({
          engines: options.engines,
          url: options.url,
          namespace: NAMESPACE,
          database: tenantDatabase(key),
          schema: tenantSchema,
          ...credentials,
        }),
      clock: options.clock,
      onError: (error) => tenantsLog.error({ code: error.code }, error.message),
    })
    const hub = new RegionHub({
      databases: regionDatabases(local, databases),
      schema: replicaSchema,
      clock: options.clock,
      onError: (error) => hubLog.error({ code: error.code }, error.message),
    })
    const organisations = new Organisations({ directory: local, databases })
    const connections = new ConnectionRegistry()

    organisations.onChange((identity, memberships) => {
      for (const connection of connections.forIdentity(identity)) {
        connection.memberships(memberships)
      }
    })

    return {
      sessions: new IdentitySessions({
        openAuth: () =>
          createAuth(local, { access: 'identity', namespace: NAMESPACE, database: DIRECTORY }),
        rpcUrl: options.rpcUrl,
        fetch,
        onCloseFailure: (error) => sessionsLog.warn({ code: error.code }, error.message),
      }),
      organisations,
      databases,
      hub,
      connections,
      local,
      clock: options.clock,
      close: async () => {
        await hub.close()
        await databases.close()
        await local.close()
      },
    }
  })
}
