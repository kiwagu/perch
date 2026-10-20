import { match, P } from 'ts-pattern'

import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { TransportContext } from './session-options'
import { deviceIdFrom, type KeyValueStorage, savedIdentity, savedKeys, saveKeys } from './storage'

/** What the session does with what the channel of one identity hears from the gateway. */
export interface SessionChannelEvents {
  /** The gateway renewed the keys, which are saved. */
  readonly renewed: () => void
  readonly memberships: (memberships: readonly Membership[]) => void
  /** The gateway refused the keys: they will not work again, and nothing renews them. */
  readonly refused: () => void
  /** The device was signed out from another device (4001). */
  readonly revoked: () => void
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
        events.renewed()
      }
    },
    onMemberships: events.memberships,
    onEnded: (reason) =>
      match(reason)
        .with('unauthorized', events.refused)
        .with('revoked', events.revoked)
        // A sign-out this device asked for is heard by `signOut`, through the sync engine; a
        // refused protocol stops the sync engine, which reports it, and changes nothing here.
        .with(P.union('signed-out', 'protocol'), () => {})
        .exhaustive(),
  }
}
