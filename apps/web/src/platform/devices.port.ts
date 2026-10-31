import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { DeviceSessionId } from '@workspace/ids'

/**
 * A device the signed-in identity is or was signed in on, as the gateway lists it: its session
 * row's id, the label the device gave itself, and `current` for this device. The browser's own
 * id stays with the gateway.
 */
export interface DeviceView {
  readonly id: DeviceSessionId
  readonly label: string
  readonly createdAt: Date
  readonly lastSeenAt: Date
  /** When it was signed out; a device signed out stays listed for 30 days. */
  readonly revokedAt?: Date
  readonly current: boolean
}

/**
 * The signed-in identity's devices at the gateway: listing them, signing one out (its session
 * ended and its sockets closed), and signing every one out, this device included.
 */
export interface DevicesPort {
  list(): ResultAsync<readonly DeviceView[], DataError>
  revoke(id: DeviceSessionId): ResultAsync<void, DataError>
  signOutEverywhere(): ResultAsync<void, DataError>
}

export const DEVICES = token<DevicesPort>('Devices')
