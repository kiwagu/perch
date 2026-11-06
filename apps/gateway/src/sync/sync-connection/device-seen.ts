/**
 * When a connection's device was last marked seen: at its hello, before its welcome, then at most
 * every five minutes while it keeps talking, which a mark never holds up.
 */

import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'

import type { DeviceSessions } from '../../auth/device-sessions'

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

  /** Marks the device seen when it was not for five minutes, without holding up what it said. */
  talked(device: ConnectedDevice): void {
    if (this.#clock.now() - this.#seenAt >= SEEN_EVERY_MS) {
      void this.mark(device.identity.id, device.id)
    }
  }

  /**
   * Marks the device seen now, waiting for nothing but the write: a failure is logged, with the
   * identity and the code only, and changes nothing for the device, so the answer never fails.
   */
  mark(identity: IdentityId, device: string): Promise<void> {
    this.#seenAt = this.#clock.now()

    return this.#devices.seen({ identity, device }).match(
      () => undefined,
      (error) => {
        this.#log.warn({ identity, code: error.code }, 'the device could not be marked seen')
      },
    )
  }
}
