import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type DeviceSessionId, device_sessionIdFactory } from '@workspace/ids'

import type { DevicesPort, DeviceView } from '../devices.port'

/** This device: a laptop. */
export const laptop: DeviceView = {
  id: device_sessionIdFactory.create(),
  label: 'Firefox on Linux',
  createdAt: new Date('2026-10-01T08:00:00.000Z'),
  lastSeenAt: new Date('2026-10-18T09:30:00.000Z'),
  current: true,
}

/** Another device of the identity: a phone. */
export const phone: DeviceView = {
  id: device_sessionIdFactory.create(),
  label: 'Safari on iPhone',
  createdAt: new Date('2026-10-02T10:00:00.000Z'),
  lastSeenAt: new Date('2026-10-17T21:15:00.000Z'),
  current: false,
}

/** The failure of a gateway out of reach. */
export const offline = (): DataError => dataError('data:OFFLINE', 'could not reach the gateway')

/** A request the gateway refused with `code`, and will refuse however often it is sent. */
export const rejected = (code: string): DataError => dataError('data:WRITE_REJECTED', code)

/** When the fake gateway signs a device out. */
export const REVOKED_AT = new Date('2026-10-18T10:00:00.000Z')

/**
 * The gateway's device routes in memory, listing `laptop` and `phone`: a device signed out
 * stays listed with `REVOKED_AT`. `refusal` makes the next call fail with it.
 */
export class FakeDevices implements DevicesPort {
  readonly calls: Array<readonly unknown[]> = []
  rows: readonly DeviceView[] = [laptop, phone]
  refusal: DataError | undefined = undefined

  #answer<T>(value: () => T): ResultAsync<T, DataError> {
    const refusal = this.refusal

    this.refusal = undefined

    return refusal ? errAsync(refusal) : okAsync(value())
  }

  list(): ResultAsync<readonly DeviceView[], DataError> {
    this.calls.push(['list'])

    return this.#answer(() => this.rows)
  }

  revoke(id: DeviceSessionId): ResultAsync<void, DataError> {
    this.calls.push(['revoke', id])

    return this.#answer(() => {
      this.rows = this.rows.map((row) => (row.id === id ? { ...row, revokedAt: REVOKED_AT } : row))
    })
  }

  signOutEverywhere(): ResultAsync<void, DataError> {
    this.calls.push(['everywhere'])

    return this.#answer(() => undefined)
  }
}
