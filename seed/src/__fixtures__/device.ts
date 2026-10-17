import { ResultAsync } from 'neverthrow'

import type { SignInInput } from '@workspace/data'
import { type AccountView, openClient, type SeedError } from '@workspace/web/seeding'

/**
 * Another device of an existing account: a new client with an empty database signs in,
 * catches up with the gateway and reads the profile it received, then leaves.
 */
export function signInAndRead(
  gatewayUrl: string,
  account: SignInInput,
): ResultAsync<AccountView, SeedError> {
  return openClient({ gatewayUrl }).andThen((device) => {
    const read = async () => {
      const view = await device.readAccount(account)

      await device.close()

      return view
    }

    return new ResultAsync(read())
  })
}
