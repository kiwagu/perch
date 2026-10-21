/**
 * When a connection's device was last marked seen: at its hello, then at most every five minutes
 * while it keeps talking. A mark never holds the connection up.
 */

import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'

import type { DeviceSessions } from '../auth/device-sessions'

import type { ConnectedDevice } from './connected-device'

/** How often at most a device is marked seen while it keeps talking. */
const SEEN_EVERY_MS = 5 * 60_000

export interface DeviceSeenDeps {
  readonly devices: Pick<DeviceSessions, 'seen'>
  readonly clock: Clock
  readonly log: Logger
}

export class DeviceSeen {
  readonly #devices: DeviceSeenDeps['devices']
  readonly #clock: Clock
  readonly #log: Logger
  /** When the device was last marked seen, on the clock. */
  #seenAt = 0

  constructor(deps: DeviceSeenDeps) {
    this.#devices = deps.devices
    this.#clock = deps.clock
    this.#log = deps.log
  }

  /** Marks the device seen when it was not for five minutes. */
  talked(device: ConnectedDevice): void {
    if (this.#clock.now() - this.#seenAt >= SEEN_EVERY_MS) {
      this.mark(device.identity.id, device.id)
    }
  }

  /**
   * Marks the device seen now, without waiting: a failure is logged, with the identity and the
   * code only, and changes nothing for the device.
   */
  mark(identity: IdentityId, device: string): void {
    this.#seenAt = this.#clock.now()
    void this.#devices.seen({ identity, device }).match(
      () => undefined,
      (error) => {
        this.#log.warn({ identity, code: error.code }, 'the device could not be marked seen')
      },
    )
  }

  /** A renewal marked the device seen as it moved the row to the new grant. */
  renewed(): void {
    this.#seenAt = this.#clock.now()
  }
}
