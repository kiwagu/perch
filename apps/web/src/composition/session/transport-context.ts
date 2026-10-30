import { match } from 'ts-pattern'

import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import { deviceIdFrom, type KeyValueStorage, savedIdentity, savedKeys, saveKeys } from '../storage'

import type { TransportContext } from './options'

/** What the session does with what the channel of one identity hears from the gateway. */
export interface SessionChannelEvents {
  /** Hears how a renewal ended: new keys, saved; or a renewal the gateway's limits refused. */
  readonly renewal: { renewed(): void; renewalRefused(): void }
  readonly memberships: (memberships: readonly Membership[]) => void
  /** The gateway refused the keys: they will not work again, and nothing renews them. */
  readonly refused: () => void
  /** The device was signed out from another device (4001). */
  readonly revoked: () => void
  /** The gateway no longer takes the protocol of this build (4400): the channel ended for good. */
  readonly protocolRefused: () => void
}

/**
 * The context of the channel of `identity`: the device it names, and the keys saved on this
 * browser while they are the identity's own (keys saved for another identity are not this
 * channel's to present, nor to replace with renewed ones).
 */
export function sessionTransportContext(
  identity: IdentityId,
  storage: KeyValueStorage,
  events: SessionChannelEvents,
): TransportContext {
  const saved = () => savedIdentity(storage)?.id === identity

  return {
    identity,
    device: deviceIdFrom(storage),
    credentials: () => (saved() ? savedKeys(storage) : undefined),
    onTokens: (tokens) => {
      if (saved()) {
        saveKeys(storage, tokens)
        events.renewal.renewed()
      }
    },
    onRenewalRefused: () => events.renewal.renewalRefused(),
    onMemberships: events.memberships,
    onEnded: (reason) =>
      match(reason)
        .with('unauthorized', events.refused)
        .with('revoked', events.revoked)
        // The sync engine stops and reports it; the app is told so that the page loads again.
        .with('protocol', events.protocolRefused)
        // A sign-out this device asked for is heard by `signOut`, through the sync engine.
        .with('signed-out', () => {})
        .exhaustive(),
  }
}
