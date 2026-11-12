/**
 * The `ORGANISATIONS` port over the gateway's routes: an organisation the identity creates is its
 * membership on this device at once, without waiting for the gateway to tell the channel, adopted
 * only into the space that asked (the adopter is taken before the request) and never in place of
 * an entry the saved memberships hold. Invites, removals and role changes adopt nothing: they
 * change memberships, whose devices (this one's among them, for a role) the gateway tells over
 * the channel.
 */

import { ResultAsync } from 'neverthrow'

import type { Membership } from '@workspace/replica/protocol'

import type { OrganisationsPort } from '../platform/organisations.port'

import type { OrganisationsApi } from './organisations-api'

/**
 * How an organisation the signed-in identity creates or accepts an invitation to becomes its
 * membership on this device: an adopter taken before the request, bound to the space asking.
 */
export interface MembershipsHolder {
  membershipAdopter(): (joined: Membership) => Promise<void>
}

export function createOrganisations(
  api: OrganisationsApi,
  session: MembershipsHolder,
): OrganisationsPort {
  return {
    create: (input) => {
      const adopt = session.membershipAdopter()

      return api
        .create(input)
        .andThen((created) => ResultAsync.fromSafePromise(adopt(created)).map(() => created))
    },
    members: (key) => api.members(key),
    invite: (key, email, role) => api.invite(key, email, role),
    invitations: (key) => api.invitations(key),
    revokeInvitation: (key, invitation) => api.revokeInvitation(key, invitation),
    setRole: (key, identity, role) => api.setRole(key, identity, role),
    remove: (key, identity) => api.remove(key, identity),
  }
}
