import { idSchemas } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { ConnectionRegistry } from '../../sync/connections'
import { SUPERSEDED } from '../../sync/sync-connection'
import { DEVICE_HEADER } from '../session-hooks'

/** As much of an accepted sign-in's answer as closing the device's sockets needs. */
const acceptedBody = z.object({ user: z.object({ id: idSchemas.identity.schema }) })

/**
 * Closes, with 1000, the sync sockets of the device a sign-in Better Auth accepted (`response`,
 * 200) was made on, for the identity its answer names. The new session ended the
 * identity's earlier one on that device, and a socket opened with the earlier token would
 * otherwise go on reading and writing with it, however long the new token stays unused. The
 * close also moves the device's epoch, so a hello with the earlier token whose session read is
 * under way is refused at registration. An answer that is not 200, names no identity, or comes
 * for a request naming no device closes nothing, and nothing of it is logged. Better Auth's
 * answer is read from a copy, so the client still gets all of it.
 */
export async function closeDevice(
  request: Request,
  response: Response,
  connections: Pick<ConnectionRegistry, 'close'>,
): Promise<void> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (response.status !== 200 || !device.success) {
    return
  }

  let body: unknown

  try {
    body = await response.clone().json()
  } catch {
    return
  }

  const accepted = acceptedBody.safeParse(body)

  if (accepted.success) {
    await connections.close(accepted.data.user.id, device.data, SUPERSEDED)
  }
}
