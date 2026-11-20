/**
 * The ids of the records a routed action names in its path, as a probe needs them: an id of the
 * right form that no record has, and an id the gateway issued for a record the action may act on,
 * which the action then answers as done. A text of the length an id's bound allows is neither:
 * the gateway issues ids of about 30 characters.
 */

import { device_sessionIdFactory, identityIdFactory, invitationIdFactory } from '@workspace/ids'

import type { World } from './platform-requests'
import type { Stand } from './stand'

/** The ids of one action's records. */
export interface Ids {
  /** An id of the form the gateway issues that names no record. */
  readonly unknown: () => string
  /** The id of a record `world`'s sender may act on, made ready for the action to be done. */
  readonly issued: (stand: Stand, world: World) => Promise<string>
}

const account: Ids = {
  unknown: () => identityIdFactory.create(),
  issued: async (_stand, world) => world.target.identity,
}

const member: Ids = {
  unknown: () => identityIdFactory.create(),
  issued: async (stand, world) => {
    await stand.join(world.sender, world.key, world.target)

    return world.target.identity
  },
}

const IDS: Readonly<Record<string, Ids>> = {
  'devices.revoke': {
    unknown: () => device_sessionIdFactory.create(),
    issued: (stand, world) => stand.otherDevice(world.sender),
  },
  'organisations.set-role': member,
  'organisations.remove': member,
  'organisations.revoke-invitation': {
    unknown: () => invitationIdFactory.create(),
    issued: (stand, world) => stand.invitation(world.sender, world.key),
  },
  // An account that never signed in has no profile to rename; a verified one needs no mail again.
  'accounts.rename': {
    ...account,
    issued: async (stand, world) => {
      await stand.profile(world.target)

      return world.target.identity
    },
  },
  'accounts.resend-verification': {
    ...account,
    issued: async (stand) => (await stand.unverified()).identity,
  },
}

/** The ids of `action`'s records; none for an action that names no record in its path. */
export const idsOf = (action: string): Ids | undefined =>
  IDS[action] ?? (action.startsWith('accounts.') ? account : undefined)
