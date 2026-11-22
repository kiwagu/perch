import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { PasskeyId } from '@workspace/ids'

/** A passkey of the signed-in account as the gateway lists it: its id and when it was added. */
export interface PasskeyView {
  readonly id: PasskeyId
  readonly createdAt: Date
}

/**
 * The signed-in account's passkeys at the gateway: listing them, adding one (the browser makes it
 * on this device or a security key), and removing one, which signs nothing in from then on while
 * the devices it signed in stay signed in.
 */
export interface PasskeysPort {
  /** The passkeys, the earliest added first. */
  list(): ResultAsync<readonly PasskeyView[], DataError>
  /**
   * Has the browser make a passkey and the gateway keep it; a window closed or timed out fails as
   * `data:PASSKEY_CANCELLED`, and nothing is added.
   */
  add(): ResultAsync<void, DataError>
  /** Removes the passkey `id` of the account; one that is none of its fails as a refusal. */
  remove(id: PasskeyId): ResultAsync<void, DataError>
}

export const PASSKEYS = token<PasskeysPort>('Passkeys')
