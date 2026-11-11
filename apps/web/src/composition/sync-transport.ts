/**
 * The channel of an identity's sync for a device of the app: the gateway's WebSocket at `url`,
 * given what the session's context of that identity holds. The browser and the seed client both
 * build their transport here, the one place a context reaches the replica's transport: the device
 * it names, the session token it presents, and where the memberships, the platform roles and the
 * channel's end go.
 */

import type { Clock } from '@workspace/replica'
import {
  type DeviceNetwork,
  type SocketLike,
  type SyncTransport,
  WebSocketTransport,
} from '@workspace/replica/sync'

import type { TransportContext } from './session'

export interface SyncTransportOptions {
  /** The gateway's sync WebSocket: `wss://…/sync`. */
  readonly url: string
  readonly clock: Clock
  /** The device's network, which brings a waiting reconnect forward once it is back. */
  readonly network?: DeviceNetwork
  /** Opens a socket; `new WebSocket(url)` by default. */
  readonly socket?: (url: string) => SocketLike
}

/** The transport of each identity's channel, over the gateway's WebSocket. */
export function syncTransport(
  options: SyncTransportOptions,
): (context: TransportContext) => SyncTransport {
  return (context) =>
    new WebSocketTransport({
      ...options,
      device: context.device,
      credentials: context.credentials,
      onMemberships: context.onMemberships,
      onRoles: context.onRoles,
      onEnded: context.onEnded,
    })
}
