/**
 * The seed client's organisations: one created as the signed-in account, its administrator, a
 * member invited into it, and one read back as a member's device sees it.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { dataError, type SignInInput } from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'

import type { OrganisationView, SeedError, SeedOrganisationDevice } from './types'

const membershipOf = (device: SeedOrganisationDevice, key: string): Membership | undefined =>
  device.session.memberships().find((membership) => membership.tenant.key === key)

/**
 * Creates the organisation as the signed-in account; one that exists and that the account
 * administers is found, one it only belongs to, and any other refusal, is an error.
 */
export function ensureOrganisation(
  device: SeedOrganisationDevice,
  input: { readonly key: string; readonly name: string },
): ResultAsync<Membership, SeedError> {
  return device.organisations
    .create(input)
    .orElse((error) => {
      const found = error.code === 'data:WRITE_REJECTED' && error.message === 'key-taken'
      const existing = found ? membershipOf(device, input.key) : undefined

      return existing?.role === 'admin' ? okAsync(existing) : errAsync(error)
    })
    .andThen((membership) => device.settle().map(() => membership))
}

/** Invites the existing account at `email` into the organisation; a member already in it is found. */
export function ensureMember(
  device: SeedOrganisationDevice,
  key: string,
  email: string,
): ResultAsync<void, SeedError> {
  return device.organisations
    .invite(key, email, 'member')
    .map(() => undefined)
    .orElse((error) =>
      error.code === 'data:WRITE_REJECTED' && error.message === 'already-member'
        ? okAsync(undefined)
        : errAsync(error),
    )
}

/** Signs in, makes the organisation current and reads its notes once the gateway's copy arrived. */
export function readOrganisation(
  device: SeedOrganisationDevice,
  key: string,
  input: SignInInput,
): ResultAsync<OrganisationView, SeedError> {
  return device
    .enter(() => device.session.signIn(input))
    .andThen(() => {
      device.session.selectTenant(key)
      const membership = device.session.currentTenant()

      return membership?.tenant.key === key
        ? device
            .settle()
            .andThen(() => device.notes.read())
            .map((rows) => ({ membership, notes: rows }))
        : errAsync<OrganisationView, SeedError>(
            dataError('data:AUTH_FAILED', `the account is no member of ${key}`),
          )
    })
}
