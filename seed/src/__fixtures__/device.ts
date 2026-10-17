import { ResultAsync } from 'neverthrow'

import type { SignInInput } from '@workspace/data'
import {
  type AccountView,
  type OrganisationView,
  openClient,
  type SeedError,
} from '@workspace/web/seeding'

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

/** An organisation as a member's other device sees it: signed in, the organisation current, its notes read. */
export function readOrganisation(
  gatewayUrl: string,
  key: string,
  account: SignInInput,
): ResultAsync<OrganisationView, SeedError> {
  return openClient({ gatewayUrl }).andThen((device) => {
    const read = async () => {
      const view = await device.readOrganisation(key, account)

      await device.close()

      return view
    }

    return new ResultAsync(read())
  })
}
