import type { AuthUser } from '@workspace/data'

import type { DeviceRegion } from './device-regions'

/** A device whose session a sync connection read. */
export interface ConnectedDevice {
  /** The id the device named itself with in its hello. */
  readonly id: string
  readonly identity: AuthUser
  /** The session token the device said hello with: a sign-out over the channel ends its session. */
  readonly token: string
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
