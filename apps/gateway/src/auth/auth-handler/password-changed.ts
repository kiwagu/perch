import type { IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import type { AuthMountDeps } from './mount'

/**
 * What follows a new password of `identity` once its transaction committed (the password, the
 * sessions it ended, the reset links and the pending change of the email, all together): the
 * sockets of the devices whose session it ended close with 4002 (`CLOSE.passwordChanged`), so each
 * device learns why it was signed out, every device of the identity after a reset (`every`), each
 * device of `ended` after a change, the device that made it staying; then the notice of a changed
 * password starts, to the account's email. The registry's closes never reject, so nothing here
 * fails; it resolves once every socket closed.
 */
export async function afterPasswordChange(
  deps: Pick<AuthMountDeps, 'connections' | 'mails'>,
  identity: IdentityId,
  ended: 'every' | readonly string[],
): Promise<void> {
  const devices = ended === 'every' ? [undefined] : ended

  await Promise.all(
    devices.map((device) => deps.connections.close(identity, device, CLOSE.passwordChanged)),
  )
  deps.mails.passwordChanged(identity)
}
