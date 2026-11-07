import type { ClientMessage, ServerMessage } from '../../protocol'

export type ChannelState = 'up' | 'down'

/**
 * Why a channel ended for good: the gateway refused the token, signed the device out at its own
 * request, refused the protocol this device speaks (an application older than the gateway),
 * signed the device out from another device (`revoked`), ended its session because the
 * account's password changed, through a reset link or on another device (`password-changed`), or
 * because a sign-in on another device went past the account's limit of devices
 * (`device-limit`).
 */
export type EndReason =
  | 'unauthorized'
  | 'signed-out'
  | 'protocol'
  | 'revoked'
  | 'password-changed'
  | 'device-limit'

export interface DeviceCredentials {
  readonly token: string
}

/** The channel between a device and the gateway that the sync engine talks through. */
export interface SyncTransport {
  start(): void
  stop(): void
  /**
   * Gives up on the current connection, which stopped answering or must present the token again,
   * and connects again after the first delay of the backoff. Nothing happens unless the gateway
   * has welcomed the connection: one still opening or waiting for its welcome says hello with the
   * token anyway, and is given up as any other is: by its close, or by the welcome wait once open.
   */
  reconnect(): void
  /** Sends when the channel is up and the gateway has welcomed the device; false otherwise. */
  send(message: ClientMessage): boolean
  onMessage(listener: (message: ServerMessage) => void): () => void
  onChannel(listener: (state: ChannelState) => void): () => void
  /** Hears that the channel ended for good; it is told before the channel goes down. */
  onEnded(listener: (reason: EndReason) => void): () => void
}

/**
 * What one region's sync uses of the transport: it sends, and has a connection that stopped
 * answering made again. `RegionSync` hands its parts a channel that refuses both once the region
 * no longer syncs on this connection.
 */
export type RegionChannel = Pick<SyncTransport, 'send' | 'reconnect'>
