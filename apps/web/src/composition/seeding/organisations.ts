/**
 * The seed client's organisations: one created as the signed-in account, its administrator, a
 * member invited into it and joining it by accepting the invitation, and one read back as a
 * member's device sees it.
 */

import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { dataError, type SignInInput } from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'

import type { Invited, OrganisationView, SeedError, SeedOrganisationDevice } from './types'

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

/**
 * Invites the existing account at `email` into the organisation as a member and answers the
 * invitation's id; an account that is a member already is found, with no invitation to accept.
 */
export function ensureInvited(
  device: Pick<SeedOrganisationDevice, 'organisations'>,
  key: string,
  email: string,
): ResultAsync<Invited, SeedError> {
  return device.organisations
    .invite(key, email, 'member')
    .map((invitation): Invited => ({ kind: 'invited', invitation: invitation.id }))
    .orElse((error) =>
      error.code === 'data:WRITE_REJECTED' && error.message === 'already-member'
        ? okAsync<Invited, SeedError>({ kind: 'already-member' })
        : errAsync(error),
    )
}

/**
 * Accepts the invitation by its id as the signed-in account, never by finding one by the
 * organisation's name (names are not unique), and waits until the gateway acknowledged the
 * membership and the organisation's region arrived.
 */
export function ensureJoined(
  device: Pick<SeedOrganisationDevice, 'invitations' | 'settle'>,
  invitation: string,
): ResultAsync<Membership, SeedError> {
  return device.invitations
    .accept(invitation)
    .andThen((membership) => device.settle().map(() => membership))
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
