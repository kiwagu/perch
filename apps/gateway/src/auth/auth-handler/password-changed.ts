import { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { DeviceSessionId, IdentityId } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'

import type { AuthMountDeps } from './mount'

/**
 * What follows a new password of `identity`, inside the account's turn: its sessions end, every
 * one, or every one but `keep`'s (the device that changed it, which stays signed in), each by the
 * gateway's own update, never Better Auth's bulk delete; the sockets of each device whose session
 * ended close with 4002 (`CLOSE.passwordChanged`), so the device learns why it was signed out;
 * every reset link of the account and its pending change of email end, so a link mailed before
 * the change changes nothing after it; and the notice of a changed password starts, to the
 * account's email. A failure stops the rest and fails the request: the password is new by then,
 * so the sessions it could not end are reported rather than left in silence.
 */
export function afterPasswordChange(
  deps: Pick<AuthMountDeps, 'sessions' | 'connections' | 'resets' | 'emailChanges' | 'mails'>,
  identity: IdentityId,
  keep?: DeviceSessionId,
): ResultAsync<void, DataError> {
  // The registry's closes never reject.
  const closing = (devices: readonly (string | undefined)[]) =>
    ResultAsync.fromSafePromise(
      Promise.all(
        devices.map((device) => deps.connections.close(identity, device, CLOSE.passwordChanged)),
      ),
    ).map(() => undefined)
  const ended: ResultAsync<void, DataError> =
    keep === undefined
      ? deps.sessions.revokeAll(identity).andThen(() => closing([undefined]))
      : deps.sessions.revokeOthers(identity, keep).andThen(closing)

  return ended
    .andThen(() => deps.resets.endAll(identity))
    .andThen(() => deps.emailChanges.cancel(identity))
    .map(() => deps.mails.passwordChanged(identity))
}
