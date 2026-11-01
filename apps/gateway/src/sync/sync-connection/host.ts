/** What the parts of a sync connection may do with it: its welcomed device and its socket. */

import type { DataError } from '@workspace/data'
import type { ServerMessage } from '@workspace/replica/protocol'

import type { ConnectedDevice } from './connected-device'

export interface ConnectionHost {
  /** The welcomed device: undefined while the hello is under way and once the socket closed. */
  device(): ConnectedDevice | undefined
  /** The welcomed device is `device` from now on: just welcomed, or its regions changed. */
  ready(device: ConnectedDevice): void
  isClosed(): boolean
  /** Whether the socket took the message: one it dropped is lost. */
  send(message: ServerMessage): boolean
  close(code: number, reason: string): void
  /** Reports a failure the connection did not expect, answers it and closes as a failed server. */
  fail(error: DataError): void
}
