/**
 * The pairs a renewal made that the device does not hold yet: delivered, dropped at once when the
 * device has no session, or parked for the device's next hello with the refresh key it still holds
 * when the socket could not take them.
 */

import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'

import type { DeviceSessions } from '../auth/device-sessions'
import { type DeviceTokens, grantIdOf, type IdentitySessions } from '../auth/identity-sessions'

export interface HelloRenewalsDeps {
  /** Where a pair is parked for the device's next hello. */
  readonly sessions: Pick<IdentitySessions, 'park'>
  /** Where the grant of a dropped pair is revoked. */
  readonly devices: Pick<DeviceSessions, 'revokeGrant'>
  /** Hears a pair parked and a grant that could not be revoked; no line carries a key or a grant id. */
  readonly log: Logger
}

/** What a hello does with a pair it renewed that the device cannot take. */
export class HelloRenewals {
  readonly #sessions: HelloRenewalsDeps['sessions']
  readonly #devices: HelloRenewalsDeps['devices']
  readonly #log: Logger

  constructor(deps: HelloRenewalsDeps) {
    this.#sessions = deps.sessions
    this.#devices = deps.devices
    this.#log = deps.log
  }

  /** Revokes the grant of a renewed pair at once; a failure is logged with the code only. */
  async drop(identity: IdentityId, pair: DeviceTokens): Promise<void> {
    const grant = grantIdOf(pair.refresh)
    const revoked =
      grant === undefined ? undefined : await this.#devices.revokeGrant({ identity, grant })

    if (revoked?.isErr()) {
      this.#log.warn(
        { identity, code: revoked.error.code },
        'the grant of a pair renewed for a device without a session could not be revoked',
      )
    }
  }

  /**
   * Hands the device a pair it does not hold yet through `send`. A pair the socket dropped, or
   * one whose send threw, is parked for the device's next hello with the key it still holds.
   * Answers whether the device got it.
   */
  deliver(
    input: {
      readonly identity: IdentityId
      readonly device: string
      readonly held: string | undefined
      readonly tokens: DeviceTokens
    },
    send: (tokens: DeviceTokens) => boolean,
  ): boolean {
    let sent = false

    try {
      sent = send(input.tokens)
    } catch {
      sent = false
    }

    if (!sent && input.held !== undefined) {
      this.park(input.identity, input.device, input.held, input.tokens)
    }

    return sent
  }

  /** Parks a pair the device could not take, for its next hello with the spent refresh key. */
  park(identity: IdentityId, device: string, spentRefresh: string, tokens: DeviceTokens): void {
    this.#sessions.park({ identity, device, spentRefresh, tokens })
    this.#log.warn(
      { identity },
      'renewed pair not delivered: parked for the next hello of the device',
    )
  }
}
