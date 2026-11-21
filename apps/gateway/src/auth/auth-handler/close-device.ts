import type { IdentityId } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'

import type { ConnectionRegistry } from '../../sync/connections'
import { SUPERSEDED } from '../../sync/sync-connection'
import { DEVICE_HEADER } from '../session-hooks'

/**
 * Closes, with 1000, the sync sockets of `identity` on the device `request` was made on, once a
 * sign-in of that identity was admitted. The admission ended the identity's earlier session on
 * that device, and a socket opened with the earlier token would otherwise go on reading and writing
 * with it, however long the new token stays unused. The close also moves the device's epoch, so a
 * hello with the earlier token whose session read is under way is refused at registration. The
 * identity is the one the sign-in was verified for, never read from an upstream answer; a request
 * naming no device closes nothing.
 */
export async function closeDevice(
  request: Request,
  identity: IdentityId,
  connections: Pick<ConnectionRegistry, 'close'>,
): Promise<void> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (device.success) {
    await connections.close(identity, device.data, SUPERSEDED)
  }
}
