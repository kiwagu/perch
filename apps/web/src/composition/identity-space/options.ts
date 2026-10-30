/** What an identity's space opens from: its databases, its memberships, its channel and its lead. */

import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'
import type { Leadership, SyncHints, SyncTransport } from '@workspace/replica/sync'

import type { TenantDatabaseInventory } from '../retained-tenant-databases'

import type { SyncState } from './leading-engine'

export interface IdentitySpaceOptions {
  readonly identity: AuthUser
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
  /** Opens the database of one organisation of the identity: each has its own on the device. */
  readonly openTenantLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one organisation of the identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  /** The organisation databases the device holds for the identity. */
  readonly tenantDatabases: TenantDatabaseInventory
  /** The organisations the identity belongs to, as the device last heard. */
  readonly memberships: readonly Membership[]
  /** The key of the organisation chosen last on this browser, if any. */
  readonly tenant: string | undefined
  readonly schema: ReplicaSchema
  /** Builds the channel to the gateway when this tab starts to lead: a WebSocketTransport in the app, the gateway stub in tests. */
  readonly transport: () => SyncTransport
  readonly leadership: Leadership | undefined
  readonly hints: SyncHints
  readonly clock: Clock
  readonly onState: (state: SyncState) => void
  readonly onError: (error: DataError) => void
}
