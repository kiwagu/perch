/**
 * The `ORGANISATIONS` port over the gateway's routes: an organisation the identity creates is its
 * membership on this device at once, without waiting for the gateway to tell the channel. Invites
 * and removals change other identities' memberships, which the gateway tells their own devices.
 */

import { ResultAsync } from 'neverthrow'

import type { Membership } from '@workspace/replica/protocol'

import type { OrganisationsPort } from '../platform/organisations.port'

import type { OrganisationsApi } from './organisations-api'

/** How an organisation the signed-in identity created becomes its membership on this device. */
export interface MembershipsHolder {
  adoptMembership(created: Membership): Promise<void>
}

export function createOrganisations(
  api: OrganisationsApi,
  session: MembershipsHolder,
): OrganisationsPort {
  return {
    create: (input) =>
      api
        .create(input)
        .andThen((created) =>
          ResultAsync.fromSafePromise(session.adoptMembership(created)).map(() => created),
        ),
    members: (key) => api.members(key),
    invite: (key, email) => api.invite(key, email),
    remove: (key, identity) => api.remove(key, identity),
  }
}
