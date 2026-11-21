import type { IdentityId } from '@workspace/ids'

import type { ConnectionRegistry } from '../../sync/connections'
import type { EndCode } from '../../sync/sync-connection'

/**
 * Closes the sync sockets of `identity` on `device` with `reason` once a sign-in of that identity
 * on that device was admitted (`SUPERSEDED`, 1000, for an admitted sign-in). The admission ended
 * the identity's earlier session on that device, and a socket opened with the earlier token would
 * otherwise go on reading and writing with it, however long the new token stays unused. The close
 * also moves the device's epoch, so a hello with the earlier token whose session read is under way
 * is refused at registration. The device is the one the request named, parsed by its caller, and
 * the identity the one the sign-in was verified for: neither is read from an upstream answer.
 */
export async function closeDevice(
  connections: Pick<ConnectionRegistry, 'close'>,
  device: string,
  identity: IdentityId,
  reason: EndCode,
): Promise<void> {
  await connections.close(identity, device, reason)
}
