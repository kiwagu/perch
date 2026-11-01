/**
 * A sign-out a device asks for over its open channel: the session its hello came with is ended,
 * as the sign-out route ends it, and every socket of the device is closed through the registry.
 */

import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'
import { CLOSE } from '@workspace/replica/protocol'

import type { AuthSessions } from '../../auth/auth-sessions'
import type { ConnectionRegistry } from '../connections'

import { REASON, SERVER_ERROR } from './reasons'

/** How the socket of a device that signed out closes. */
export interface SignOutClose {
  readonly code: number
  readonly reason: string
}

export interface ChannelSignOutDeps {
  readonly sessions: Pick<AuthSessions, 'signOut'>
  /** Closes the device's sockets once its session ended, the one that signed out among them. */
  readonly connections: Pick<ConnectionRegistry, 'close'>
  /** Hears a session that could not be ended, with the identity and the code; never a token. */
  readonly log: Logger
}

/**
 * Ends the session that `token` of `device` of `identity` holds, and answers how its socket
 * closes: as signed out (4000) once the session ended. Every socket of the device is closed with
 * 4000 through the registry then, which moves the device's epoch: a hello of it that read the
 * session before it ended is refused its registration. A session that cannot be ended is logged
 * with the identity and the code, nothing is closed through the registry, and the socket closes
 * as a failed server (1011): the device must not take the sign-out close for an ended session,
 * and sends the sign-out again through the route, which completes it.
 */
export async function signOutOnChannel(
  deps: ChannelSignOutDeps,
  input: { readonly identity: IdentityId; readonly device: string; readonly token: string },
): Promise<SignOutClose> {
  const { identity, device, token } = input
  const ended = await deps.sessions.signOut(token)

  if (ended.isErr()) {
    deps.log.warn(
      { identity, code: ended.error.code },
      'the session of a device that signed out could not be ended',
    )

    return { code: SERVER_ERROR, reason: REASON.revokeFailed }
  }

  await deps.connections.close(identity, device, CLOSE.signedOut)

  return { code: CLOSE.signedOut, reason: REASON.signedOut }
}
