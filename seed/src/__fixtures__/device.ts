import { okAsync, ResultAsync } from 'neverthrow'

import type { SignInInput } from '@workspace/data'
import {
  type AccountInput,
  type AccountView,
  type ClientOptions,
  type Invited,
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

/** The account signs in on a new device, accepts the invitation by its id, then leaves. */
function acceptAs(
  client: ClientOptions,
  member: SignInInput,
  invitation: string,
): ResultAsync<void, SeedError> {
  return openClient(client).andThen((device) => {
    const accept = async () => {
      const result = await device
        .signIn(member)
        .andThen(() => device.ensureJoined(invitation))
        .map(() => undefined)

      await device.close()

      return result
    }

    return new ResultAsync(accept())
  })
}

/**
 * Another account creates an organisation and invites the existing account at `member`'s email
 * into it, then leaves; the account is a member only once it signs in on a device of its own and
 * accepts, as this does. `inviteInto` leaves the invitation pending.
 */
export function inviteAndJoin(
  client: ClientOptions,
  founder: AccountInput,
  organisation: { readonly key: string; readonly name: string },
  member: SignInInput,
): ResultAsync<void, SeedError> {
  return inviteInto(client, founder, organisation, member.email).andThen((invited) =>
    invited.kind === 'invited'
      ? acceptAs(client, member, invited.invitation)
      : okAsync<void, SeedError>(undefined),
  )
}

/**
 * Another account creates an organisation and invites the existing account at `email` into it,
 * then leaves: the invitation stays pending, and is answered as the invite answered it.
 */
export function inviteInto(
  client: ClientOptions,
  founder: AccountInput,
  organisation: { readonly key: string; readonly name: string },
  email: string,
): ResultAsync<Invited, SeedError> {
  return openClient(client).andThen((device) => {
    const invite = async () => {
      const result = await device
        .ensureAccount(founder)
        .andThen(() => device.ensureOrganisation(organisation))
        .andThen(() => device.ensureInvited(organisation.key, email))

      await device.close()

      return result
    }

    return new ResultAsync(invite())
  })
}

/**
 * The administrator of an organisation signs in on a new device and invites `email` (an address
 * that may have no account) into it as a member, then leaves: the invitation stays pending.
 */
export function inviteAs(
  client: ClientOptions,
  administrator: SignInInput,
  key: string,
  email: string,
): ResultAsync<Invited, SeedError> {
  return openClient(client).andThen((device) => {
    const invite = async () => {
      const result = await device
        .signIn(administrator)
        .andThen(() => device.ensureInvited(key, email))

      await device.close()

      return result
    }

    return new ResultAsync(invite())
  })
}

/** The account signs in on a new device and creates the organisation, or finds it, then leaves. */
export function ensureOrganisationAs(
  client: ClientOptions,
  account: SignInInput,
  organisation: { readonly key: string; readonly name: string },
): ResultAsync<void, SeedError> {
  return openClient(client).andThen((device) => {
    const ensure = async () => {
      const result = await device
        .signIn(account)
        .andThen(() => device.ensureOrganisation(organisation))
        .map(() => undefined)

      await device.close()

      return result
    }

    return new ResultAsync(ensure())
  })
}
