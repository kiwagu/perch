import type { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'
import type {
  DeviceCredentials,
  EndReason,
  LockManagerLike,
  SyncHints,
  SyncTransport,
} from '@workspace/replica/sync'

import type { ChangeRejected, ChangesReloaded, ProtocolRefused } from '../../platform/events.port'
import type { GatewayAuth } from '../gateway-auth'
import type { SyncState, Visibility } from '../identity-space'
import type { KeyValueStorage } from '../storage'

/**
 * What the channel of one identity needs: the device it names in its hello, the session token
 * it presents, where memberships go, its end.
 */
export interface TransportContext {
  readonly identity: IdentityId
  /** The browser's own id (`perch.device.id`). */
  readonly device: string
  readonly credentials: () => DeviceCredentials | undefined
  readonly onMemberships: (memberships: readonly Membership[]) => void
  readonly onEnded: (reason: EndReason) => void
}

/** Whether the tab is in the foreground, and how to hear that it changed. */
export interface VisibilitySource {
  current(): Visibility
  onChange(listener: (state: Visibility) => void): () => void
}

export interface SessionOptions {
  readonly auth: GatewayAuth
  /**
   * The memberships of the identity a sign-in just signed in, as the gateway lists them
   * (`GET /organisations`), read with the session token it was given and the device it named:
   * nothing of the sign-in is saved before the read answers.
   */
  readonly listMemberships: (
    token: string,
    device: string,
  ) => ResultAsync<readonly Membership[], DataError>
  /** The label a sign-up or sign-in gives this browser, next to its own id: "Chrome on Linux". */
  readonly deviceLabel: string
  /** Whether the browser says it has a network: only then is a token left to sign out sent unasked. */
  readonly online: () => boolean
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one identity while it is not open. */
  readonly deleteLocal: (identity: IdentityId) => ResultAsync<void, DataError>
  /** Opens the database of one organisation of an identity: each has its own on the device. */
  readonly openTenantLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one organisation of an identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  readonly schema: ReplicaSchema
  readonly transport: (context: TransportContext) => SyncTransport
  /**
   * The browser's Web Locks: one makes one tab per browser the identity's sync leader, another
   * lets a sign-out wait for the writes every tab admitted. Undefined without Web Locks: such a
   * browser does not sync, and its sign-out waits for no other tab.
   */
  readonly locks: LockManagerLike | undefined
  readonly hints: (identity: IdentityId) => SyncHints
  readonly clock: Clock
  readonly storage: KeyValueStorage
  readonly visibility: VisibilitySource
  /** An identity's space starts to open (`open-db`) or is open (`ready`). */
  readonly onStep?: (step: 'open-db' | 'ready') => void
  readonly onSyncState: (state: SyncState) => void
  readonly onError: (error: DataError) => void
  /**
   * Tells the app a change the gateway refused, or refused again, and a sync protocol it no longer
   * takes; the root publishes it on the bus.
   */
  readonly publish: (event: ChangeRejected | ChangesReloaded | ProtocolRefused) => void
}
