import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { TwoFactorId } from '@workspace/ids'

/**
 * What turning the second factor on starts: the key for an authenticator app, as the text it is
 * typed from (`key`) and the `otpauth://` address a QR code carries (`uri`), the ten backup codes
 * shown once, and the enrolment the code that confirms the key names (`confirm`). The second
 * factor stays off until then.
 */
export interface TwoFactorEnrolment {
  readonly key: string
  readonly uri: string
  readonly backupCodes: readonly string[]
  readonly enrolment: TwoFactorId
}

/**
 * The signed-in account's second factor at the gateway. Every change confirms the account's
 * password (a wrong one fails as `data:INVALID_CREDENTIALS`, counted among the email's failed
 * sign-ins) and a request to wait fails as `data:RATE_LIMITED`; the other devices of the account
 * stay signed in. A factor that is not as the request found it (turned on or off, or its key
 * replaced, from another device) fails as `data:TWO_FACTOR_CHANGED`, changing nothing.
 */
export interface TwoFactorPort {
  /** Whether the second factor is on. */
  read(): ResultAsync<{ readonly enabled: boolean }, DataError>
  /** Starts turning it on, or replaces the key and the codes of a start not confirmed yet. */
  enable(password: string): ResultAsync<TwoFactorEnrolment, DataError>
  /**
   * Turns it on with a code the key shows now, for the `enrolment` the start answered; a code the
   * key does not give fails as `data:INVALID_CODE`.
   */
  confirm(code: string, enrolment: TwoFactorId): ResultAsync<void, DataError>
  /** Turns it off, its key and its codes with it; an account whose factor is off answers alike. */
  disable(password: string): ResultAsync<void, DataError>
  /** Replaces the backup codes: ten new ones, the earlier ones refused from then on. */
  renewCodes(password: string): ResultAsync<{ readonly backupCodes: readonly string[] }, DataError>
}

export const TWO_FACTOR = token<TwoFactorPort>('TwoFactor')
