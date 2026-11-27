import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type PasskeyId, passkeyIdFactory } from '@workspace/ids'

import type { PasskeysPort, PasskeyView } from '../passkeys.port'

/** The first passkey of the fake gateway's account: made on the laptop. */
export const laptopKey: PasskeyView = {
  id: passkeyIdFactory.create(),
  createdAt: new Date('2026-10-01T08:00:00.000Z'),
}

/** The second one: a security key. */
export const securityKey: PasskeyView = {
  id: passkeyIdFactory.create(),
  createdAt: new Date('2026-10-05T12:30:00.000Z'),
}

/** When the fake gateway keeps a passkey the browser made. */
export const ADDED_AT = new Date('2026-10-18T09:00:00.000Z')

/**
 * The gateway's passkey routes in memory, listing `laptopKey` and `securityKey`, the earliest
 * first. `refusal` makes the next call fail with it.
 */
export class FakePasskeys implements PasskeysPort {
  readonly calls: Array<readonly unknown[]> = []
  rows: readonly PasskeyView[] = [laptopKey, securityKey]
  refusal: DataError | undefined = undefined

  #answer<T>(value: () => T): ResultAsync<T, DataError> {
    const refusal = this.refusal

    this.refusal = undefined

    return refusal ? errAsync(refusal) : okAsync(value())
  }

  list(): ResultAsync<readonly PasskeyView[], DataError> {
    this.calls.push(['list'])

    return this.#answer(() => this.rows)
  }

  add(): ResultAsync<void, DataError> {
    this.calls.push(['add'])

    return this.#answer(() => {
      this.rows = [...this.rows, { id: passkeyIdFactory.create(), createdAt: ADDED_AT }]
    })
  }

  remove(id: PasskeyId): ResultAsync<void, DataError> {
    this.calls.push(['remove', id])

    return this.rows.some((row) => row.id === id)
      ? this.#answer(() => {
          this.rows = this.rows.filter((row) => row.id !== id)
        })
      : errAsync(dataError('data:WRITE_REJECTED', 'failed'))
  }
}
