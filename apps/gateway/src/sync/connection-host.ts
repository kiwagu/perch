/** What the parts of a sync connection may do with it: its welcomed device and its socket. */

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { ServerMessage } from '@workspace/replica/protocol'

import type { DeviceTokens } from '../auth/identity-sessions'

import type { ConnectedDevice } from './connected-device'

export interface ConnectionHost {
  /** The welcomed device: undefined while the hello is under way and once the socket closed. */
  device(): ConnectedDevice | undefined
  /** The welcomed device is `device` from now on: just welcomed, or its regions or keys changed. */
  ready(device: ConnectedDevice): void
  isClosed(): boolean
  /** Whether the socket took the message: one it dropped is lost. */
  send(message: ServerMessage): boolean
  /**
   * Sends a pair the device does not hold yet. One a closed socket cannot take, or one the socket
   * dropped or threw on, is parked, and an open socket closes so the device comes back.
   */
  sendTokens(
    identity: IdentityId,
    device: string,
    held: string | undefined,
    tokens: DeviceTokens,
  ): boolean
  close(code: number, reason: string): void
  /** Reports a failure the connection did not expect, answers it and closes as a failed server. */
  fail(error: DataError): void
}
