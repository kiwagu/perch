import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import { errAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import type { PasskeyCeremony } from '../passkey-ceremony'

/** The assertion a browser answers when the person picks the passkey of `credential`. */
export function assertionOf(credential: string): AuthenticationResponseJSON {
  return {
    id: credential,
    rawId: credential,
    type: 'public-key',
    clientExtensionResults: {},
    response: { authenticatorData: 'BA', clientDataJSON: 'BQ', signature: 'Bg' },
  }
}

/** A browser's passkey window, counting how many times it was asked to open. */
export interface FakeCeremony extends PasskeyCeremony {
  readonly windows: number
}

/**
 * A browser whose window answers an assertion as `authenticate` says (a window nobody answers
 * fails by default); a window to make a passkey is not in these tests.
 */
export function fakeCeremony(
  authenticate: (
    options: PublicKeyCredentialRequestOptionsJSON,
  ) => ResultAsync<AuthenticationResponseJSON, DataError> = () =>
    errAsync(dataError('data:AUTH_FAILED', 'no passkey window in this test')),
): FakeCeremony {
  let windows = 0

  return {
    get windows() {
      return windows
    },
    authenticate: (options) => {
      windows += 1

      return authenticate(options)
    },
    register: () => errAsync(dataError('data:AUTH_FAILED', 'no passkey is made in this test')),
  }
}
