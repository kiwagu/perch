import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'

import type { DevicesPort, DeviceView } from '../../../platform/devices.port'
import type { SessionPort } from '../../../platform/session.port'

/** What the service needs of the session: signing this device out. */
export type DevicesSession = Pick<SessionPort, 'signOut'>

/**
 * How a sign-out of one device ended: another device signed out and the list read again
 * (`listed`), or signed out while the list could not be read again (`revoked`); this device
 * signed out through its session (`signed-out`), or not yet because it holds changes it could
 * not send (`needs-confirmation`, nothing changed).
 */
export type RevokeOutcome =
  | { readonly kind: 'listed'; readonly devices: readonly DeviceView[] }
  | { readonly kind: 'revoked' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'needs-confirmation' }

/**
 * The signed-in identity's devices: listing them, signing one out and signing out everywhere.
 * This device signs out through its session, which sends what it can and forgets its keys and
 * data; every other device through the gateway's device route.
 */
export class DevicesService {
  constructor(
    private readonly devices: DevicesPort,
    private readonly session: DevicesSession,
  ) {}

  list(): ResultAsync<readonly DeviceView[], DataError> {
    return this.devices.list()
  }

  /** Signs `device` out; another device's sign-out reads the list again. */
  revoke(device: Pick<DeviceView, 'id' | 'current'>): ResultAsync<RevokeOutcome, DataError> {
    if (device.current) {
      return this.session.signOut().map((outcome) => ({ kind: outcome }))
    }

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
