/**
 * The `INVITATIONS` port over the gateway's routes: an invitation the account accepts is its
 * membership on this device at once, as an organisation it creates is, without waiting for the
 * gateway to tell the channel. Reading, listing and declining change no membership.
 */

import { ResultAsync } from 'neverthrow'

import type { InvitationsPort } from '../platform/invitations.port'

import type { MembershipsHolder } from './organisations'

/**
 * `api` with the accept adopting its membership: the accept answers once the session took it in
 * (its organisation database opened), so whoever selects the organisation then finds it.
 */
export function createInvitations(
  api: InvitationsPort,
  session: MembershipsHolder,
): InvitationsPort {
  return {
    read: (token) => api.read(token),
    mine: () => api.mine(),
    accept: (invitation) =>
      api
        .accept(invitation)
        .andThen((accepted) =>
          ResultAsync.fromSafePromise(session.adoptMembership(accepted)).map(() => accepted),
        ),
    decline: (invitation) => api.decline(invitation),
  }
}
