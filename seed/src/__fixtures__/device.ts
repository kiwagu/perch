import { ResultAsync } from 'neverthrow'

import type { SignInInput } from '@workspace/data'
import {
  type AccountInput,
  type AccountView,
  type ClientOptions,
  type OrganisationView,
  openClient,
  type SeedError,
} from '@workspace/web/seeding'

/**
 * Another device of an existing account: a new client with an empty database signs in,
 * catches up with the gateway and reads the profile it received, then leaves.
 */
export function signInAndRead(
  client: ClientOptions,
  account: SignInInput,
): ResultAsync<AccountView, SeedError> {
  return openClient(client).andThen((device) => {
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
  client: ClientOptions,
  key: string,
  account: SignInInput,
): ResultAsync<OrganisationView, SeedError> {
  return openClient(client).andThen((device) => {
    const read = async () => {
      const view = await device.readOrganisation(key, account)

      await device.close()

      return view
    }

    return new ResultAsync(read())
  })
}

/** Another account creates an organisation and invites the existing account at `email` into it, then leaves. */
export function inviteInto(
  client: ClientOptions,
  founder: AccountInput,
  organisation: { readonly key: string; readonly name: string },
  email: string,
): ResultAsync<void, SeedError> {
  return openClient(client).andThen((device) => {
    const invite = async () => {
      const result = await device
        .ensureAccount(founder)
        .andThen(() => device.ensureOrganisation(organisation))
        .andThen(() => device.ensureMember(organisation.key, email))

      await device.close()

      return result
    }

    return new ResultAsync(invite())
  })
}
