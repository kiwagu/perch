/** What a device's sync connection needs: its socket, and the gateway's services it calls. */

import type { DataError } from '@workspace/data'
import type { Logger } from '@workspace/logger'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import type { RegionHub } from '@workspace/replica/server'

import type { DeviceSessions } from '../auth/device-sessions'
import type { IdentitySessions, RenewalGate } from '../auth/identity-sessions'
import type { Organisations } from '../tenants/organisations'

import type { ConnectionRegistry } from './connections'

export interface SocketLike {
  /** 0 when the socket dropped the message, -1 when it queued it, else the bytes it sent. */
  send(text: string): number
  close(code: number, reason: string): void
}

export interface SyncConnectionDeps {
  readonly sessions: Pick<
    IdentitySessions,
    'authenticate' | 'renew' | 'exclusively' | 'park' | 'parked' | 'unpark'
  >
  /**
   * The devices' rows: a hello is bound to its device's row (moved to the new grant when the
   * hello renews the pair), the device is marked seen at its hello and then at most every five
   * minutes, and a sign-out marks the row and revokes the device's grant.
   */
  readonly devices: Pick<DeviceSessions, 'seen' | 'bind' | 'rotate' | 'revokeGrant' | 'signedOut'>
  readonly hub: Pick<RegionHub, 'subscribe' | 'unsubscribe' | 'pull' | 'push' | 'heads' | 'compact'>
  readonly organisations: Pick<Organisations, 'membershipsOf'>
  /** Where the connection registers once the keys are accepted, to hear its memberships change. */
  readonly connections: ConnectionRegistry
  readonly clock: Clock
  /** The gate a hello of `device` asks before its refresh key is exchanged: the renewal limits. */
  readonly renewals: (device: string) => RenewalGate
  /** Hears sign-outs and failures; no line carries a token, a key or a grant id. */
  readonly log: Logger
  /** How long a device may stay silent before its hello; 10 s by default. */
  readonly helloTimeoutMs?: number
  /**
   * Hears each failure the connection did not expect; the device was answered with an
   * internal error and its socket closed. Logged at error level by default.
   */
  readonly onError?: (error: DataError) => void
  /** Who may write what in each region: the abilities of a member are built from it. */
  readonly schema: ReplicaSchema
}
