import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'

import type { DevicesPort, DeviceView } from '../../../platform/devices.port'

/**
 * How a sign-out of another device ended: the list read again (`listed`), or signed out while
 * the list could not be read again (`revoked`).
 */
export type RevokeOutcome =
  | { readonly kind: 'listed'; readonly devices: readonly DeviceView[] }
  | { readonly kind: 'revoked' }

/**
 * The signed-in identity's devices: listing them, signing another one out and signing out
 * everywhere, through the gateway's device routes. This device is signed out from the profile,
 * through its session, which sends what it can and forgets its keys and data.
 */
export class DevicesService {
  constructor(private readonly devices: DevicesPort) {}

  list(): ResultAsync<readonly DeviceView[], DataError> {
    return this.devices.list()
  }

  /** Signs another device out, then reads the list again. */
  revoke(device: Pick<DeviceView, 'id'>): ResultAsync<RevokeOutcome, DataError> {
    // The sign-out went through even when the list read after it fails.
    return this.devices.revoke(device.id).andThen(() =>
      this.devices
        .list()
        .map((devices): RevokeOutcome => ({ kind: 'listed', devices }))
        .orElse(() => okAsync<RevokeOutcome, DataError>({ kind: 'revoked' })),
    )
  }

  /**
   * Signs every device of the identity out, this one included. Only the gateway's answer is
   * awaited: it closes this device's channel too, and the session signs the device out on that.
   */
  signOutEverywhere(): ResultAsync<void, DataError> {
    return this.devices.signOutEverywhere()
  }
}

export const DEVICES_SERVICE = token<DevicesService>('DevicesService')
