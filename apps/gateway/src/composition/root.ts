/**
 * The gateway's composition root: the only module of the gateway that opens the central
 * database and the organisations' databases, and builds the services over them.
 */

import type { ResultAsync } from 'neverthrow'

import {
  type DataError,
  type Engines,
  type LocalDb,
  openLocalDb,
  tenantDatabase,
} from '@workspace/data'
import { readSchema } from '@workspace/data/schema-files'
import { replicaSchema } from '@workspace/database/replica-schema'
import { createLogger } from '@workspace/logger'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import { RegionHub } from '@workspace/replica/server'

import { type AuthInstance, createAuthInstance } from '../auth/auth-instance'
import { AuthSessions } from '../auth/auth-sessions'
import { DeviceSessions } from '../auth/device-sessions'
import { DIRECTORY, FRONT_PREFIX, NAMESPACE } from '../config'
import { RequestLimits } from '../limits/request-limits'
import { ConnectionRegistry } from '../sync/connections'
import { Organisations } from '../tenants/organisations'
import { regionDatabases } from '../tenants/region-databases'
import { TenantDatabases } from '../tenants/tenant-databases'

export interface GatewayRoot {
  /**
   * Better Auth over the directory: the server hands it the sign-up and the sign-in under
   * `/auth`; the gateway reads sessions through its API.
   */
  readonly auth: AuthInstance
  /** The sessions of devices: read through Better Auth, ended by the gateway's own updates. */
  readonly sessions: AuthSessions
  /** The session rows of each identity's devices: listed, looked up by token, marked seen. */
  readonly deviceSessions: DeviceSessions
  readonly organisations: Organisations
  /** The organisations' databases, each opened on first use. */
  readonly databases: TenantDatabases
  /**
   * The region hub: it keeps private regions in the directory and each tenant region in its
   * organisation's database.
   */
  readonly hub: RegionHub
  /** Which tables replicate, and who may write what in them. */
  readonly schema: ReplicaSchema
  /**
   * The open sync connections of each identity and device: told of every change of its
   * memberships, a removed identity's lose the organisation's region at once, and a device
   * signed out from another one is closed.
   */
  readonly connections: ConnectionRegistry
  /** The directory database. */
  readonly local: LocalDb
  /**
   * The request limits of this process: the failed sign-ins of each email, the invitations and
   * the organisations created.
   */
  readonly limits: RequestLimits
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
  /**
   * The database's WebSocket endpoint: the directory's connection, opened as the gateway's
   * namespace user, which Better Auth's adapter queries through too.
   */
  readonly url: string
  /** The gateway's namespace user; an embedded database needs none. */
  readonly credentials?: { readonly username: string; readonly password: string }
  /** The secret Better Auth signs and encrypts with. */
  readonly authSecret: string
  /**
   * The front's public origin, with no trailing slash: the base of the auth routes' public URL
   * and the one origin Better Auth trusts.
   */
  readonly publicUrl: string
  readonly clock: Clock
}

export function createGatewayRoot(
  options: GatewayRootOptions,
): ResultAsync<GatewayRoot, DataError> {
  const hubLog = createLogger('region-hub')
  const tenantsLog = createLogger('tenant-databases')
  const connectionsLog = createLogger('connections')
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
    // The code and the gateway's own message, never the cause: a socket's text may hold anything.
    const connections = new ConnectionRegistry({
      onFailure: (error) => connectionsLog.error({ code: error.code }, error.message),
    })
    // A removal takes the organisation's region from the removed identity's connections before
    // anything else can fail; every change of memberships resolves once its devices were told.
    const organisations = new Organisations({
      directory: local,
      databases,
      revoke: (identity, region) => connections.revoke(identity, region),
    })

    organisations.onChange((identity, memberships) => connections.tell(identity, memberships))

    // Better Auth serves its routes under the path of its public URL only, so the server hands it
    // each `/auth/<rest>` it receives at `${FRONT_PREFIX}/auth/<rest>`.
    const auth = createAuthInstance({
      local,
      secret: options.authSecret,
      baseURL: `${options.publicUrl}${FRONT_PREFIX}/auth`,
      trustedOrigins: [options.publicUrl],
      clock: options.clock,
    })

    return {
      auth,
      sessions: new AuthSessions({ auth, directory: local, clock: options.clock }),
      deviceSessions: new DeviceSessions({ directory: local, clock: options.clock }),
      organisations,
      databases,
      hub,
      schema: replicaSchema,
      connections,
      local,
      limits: new RequestLimits({ clock: options.clock }),
      clock: options.clock,
      close: async () => {
        await hub.close()
        await databases.close()
        await local.close()
      },
    }
  })
}
