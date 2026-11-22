import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { type TwoFactorId, two_factorIdFactory } from '@workspace/ids'

import type { TwoFactorEnrolment, TwoFactorPort } from '../two-factor.port'

/** The password of the account the fake gateway's second factor belongs to. */
export const FACTOR_PASSWORD = 'Secret-ann1'

/** The code the key of a start gives while it is confirmed. */
export const RIGHT_CODE = '123456'

/** The key a start of the fake gateway answers, as an authenticator app types it. */
export const KEY = 'JBSWY3DPEHPK3PXP'

/** The ten backup codes of a start, and the ten of a renewal. */
export const START_CODES: readonly string[] = Array.from(
  { length: 10 },
  (_, index) => `start-code-${index}`,
)
export const RENEWED_CODES: readonly string[] = Array.from(
  { length: 10 },
  (_, index) => `renewed-code-${index}`,
)

/** A request the gateway refused with `code`. */
export const refusedWith = (code: DataError['code']): DataError => dataError(code, 'refused')

/**
 * The gateway's second factor routes in memory: off until a start is confirmed with `RIGHT_CODE`;
 * a start replaces the one before it, and a code for a replaced start (or once the factor is on)
 * is `data:TWO_FACTOR_CHANGED`. `refusal` makes the next call fail with it.
 */
export class FakeTwoFactor implements TwoFactorPort {
  readonly calls: Array<readonly unknown[]> = []
  enabled = false
  refusal: DataError | undefined = undefined
  #start: TwoFactorId | undefined = undefined

  #answer<T>(value: () => T): ResultAsync<T, DataError> {
    const refusal = this.refusal

    this.refusal = undefined

    return refusal ? errAsync(refusal) : okAsync(value())
  }

  #checked<T>(password: string, value: () => T): ResultAsync<T, DataError> {
    return password === FACTOR_PASSWORD
      ? this.#answer(value)
      : errAsync(refusedWith('data:INVALID_CREDENTIALS'))
  }

  read(): ResultAsync<{ readonly enabled: boolean }, DataError> {
    this.calls.push(['read'])

    return this.#answer(() => ({ enabled: this.enabled }))
  }

  enable(password: string): ResultAsync<TwoFactorEnrolment, DataError> {
    this.calls.push(['enable', password])

    return this.enabled
      ? errAsync(refusedWith('data:TWO_FACTOR_CHANGED'))
      : this.#checked(password, () => {
          this.#start = two_factorIdFactory.create()

          return {
            key: KEY,
            uri: `otpauth://totp/Perch:ann%40example.test?secret=${KEY}&issuer=Perch`,
            backupCodes: START_CODES,
            enrolment: this.#start,
          }
        })
  }

  confirm(code: string, enrolment: TwoFactorId): ResultAsync<void, DataError> {
    this.calls.push(['confirm', code, enrolment])

    if (this.enabled || enrolment !== this.#start) {
      return errAsync(refusedWith('data:TWO_FACTOR_CHANGED'))
    }

    return code === RIGHT_CODE
      ? this.#answer(() => {
          this.enabled = true
        })
      : errAsync(refusedWith('data:INVALID_CODE'))
  }

  disable(password: string): ResultAsync<void, DataError> {
    this.calls.push(['disable', password])

    return this.#checked(password, () => {
      this.enabled = false
    })
  }

  renewCodes(
    password: string,
  ): ResultAsync<{ readonly backupCodes: readonly string[] }, DataError> {
    this.calls.push(['renew', password])

    return this.enabled
      ? this.#checked(password, () => ({ backupCodes: RENEWED_CODES }))
      : errAsync(refusedWith('data:TWO_FACTOR_CHANGED'))
  }
}
