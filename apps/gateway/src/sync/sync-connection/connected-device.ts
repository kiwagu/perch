import type { AuthTokens, AuthUser } from '@workspace/data'

import type { DeviceRegion } from './device-regions'

/** A device whose keys a sync connection accepted. */
export interface ConnectedDevice {
  /** The id the device named itself with in its hello. */
  readonly id: string
  readonly identity: AuthUser
  /** The keys it holds now: as it came with them, or renewed at hello or over the channel since. */
  readonly tokens: AuthTokens
  /**
   * The regions the device may name, by id: the identity's private region as its owner, and the
   * region of each organisation it belongs to with the member's role.
   */
  readonly regions: ReadonlyMap<string, DeviceRegion>
}

/** Where a sync connection is: waiting for the hello, serving its device, or closed. */
export type ConnectionState =
  | { readonly kind: 'waiting'; readonly cancelHello: () => void }
  | { readonly kind: 'ready'; readonly device: ConnectedDevice }
  | { readonly kind: 'closed' }
