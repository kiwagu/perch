import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { PasskeyId } from '@workspace/ids'

import type { PasskeysPort, PasskeyView } from '../../../platform/passkeys.port'

/**
 * The signed-in account's passkeys through the gateway: listing them, adding one (the browser
 * makes it, on this device or a security key) and removing one.
 */
export class PasskeysService {
  constructor(private readonly passkeys: PasskeysPort) {}

  /** The passkeys, the earliest added first. */
  list(): ResultAsync<readonly PasskeyView[], DataError> {
    return this.passkeys.list()
  }

  /** Has the browser make a passkey and the gateway keep it; a window closed fails as `data:PASSKEY_CANCELLED`. */
  add(): ResultAsync<void, DataError> {
    return this.passkeys.add()
  }

  /** Removes the passkey `id`: it signs nothing in from then on. */
  remove(id: PasskeyId): ResultAsync<void, DataError> {
    return this.passkeys.remove(id)
  }
}

export const PASSKEYS_SERVICE = token<PasskeysService>('PasskeysService')
