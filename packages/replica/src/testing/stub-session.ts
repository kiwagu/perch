import type { Connection, Gateway } from './stub-state'

/**
 * The gateway took the device's token: it welcomes the device with its regions and the stub's
 * memberships, and no platform role.
 */
export function welcome(
  gateway: Gateway,
  connection: Connection,
  identity: string,
  regions: ReadonlyArray<{ readonly region: string; readonly head: number }>,
): void {
  connection.subscriber.send({
    type: 'welcome',
    identity: identity,
    regions: [...regions],
    memberships: [...gateway.memberships],
    roles: [],
    time: gateway.clock.now(),
  })
}

/** What a sign-out may do to the device's channel. */
export interface SignOutChannel {
  /** The hub forgets the connection in every region the device may name. */
  leave(): void
  /** The connection is gone; the device may come back. */
  drop(): void
  /** The channel ends for good as signed out, if the connection is still the device's. */
  end(): void
}

/** The gateway leaves the device's regions and closes the channel for good. */
export function signOut(gateway: Gateway, connection: Connection, channel: SignOutChannel): void {
  const keptOpen = gateway.keepOpen
  const failed = gateway.failSignOut

  gateway.signOuts += 1

  if (keptOpen) {
    gateway.keepOpen = undefined
    connection.signedOut = true
    channel.leave()
    keptOpen()

    return
  }

  // A close that ends nothing: the connection is gone, the device may come back.
  if (failed) {
    gateway.failSignOut = undefined
    failed()
    channel.drop()

    return
  }

  channel.end()
}
