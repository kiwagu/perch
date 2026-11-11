import { match } from 'ts-pattern'

import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import type { DeviceCredentials } from '@workspace/replica/sync'

import { deviceIdFrom, type KeyValueStorage, savedTokenOf } from '../storage'

import type { TransportContext } from './options'

/** What the session does with what the channel of one identity hears from the gateway. */
export interface SessionChannelEvents {
  readonly memberships: (memberships: readonly Membership[]) => void
  /** The gateway refused the session token: it will not work again. */
  readonly refused: () => void
  /** The device was signed out from another device (4001). */
  readonly revoked: () => void
  /** The device was signed out because the account's password changed (4002). */
  readonly passwordChanged: () => void
  /** The device was signed out because a sign-in went past the account's limit of devices (4003). */
  readonly deviceLimit: () => void
  /** The device was signed out because an operator banned the account (4004). */
  readonly banned: () => void
  /** The gateway no longer takes the protocol of this build (4400): the channel ended for good. */
  readonly protocolRefused: () => void
}

/** The token the channel presents in its hello, if the device keeps one. */
function credentialsOf(token: string | undefined): DeviceCredentials | undefined {
  return token === undefined ? undefined : { token }
}

/**
 * The context of the channel of `identity`: the device it names, and the session token saved on
 * this browser while it is the identity's own (a token saved for another identity is not this
 * channel's to present).
 */
export function sessionTransportContext(
  identity: IdentityId,
  storage: KeyValueStorage,
  events: SessionChannelEvents,
): TransportContext {
  return {
    identity,
    device: deviceIdFrom(storage),
    credentials: () => credentialsOf(savedTokenOf(storage, identity)),
    onMemberships: events.memberships,
    onEnded: (reason) =>
      match(reason)
        .with('unauthorized', events.refused)
        .with('revoked', events.revoked)
        .with('password-changed', events.passwordChanged)
        .with('device-limit', events.deviceLimit)
        .with('banned', events.banned)
        // The sync engine stops and reports it; the app is told so that the page loads again.
        .with('protocol', events.protocolRefused)
        // A sign-out this device asked for is heard by `signOut`, through the sync engine.
        .with('signed-out', () => {})
        .exhaustive(),
  }
}
