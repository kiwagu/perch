/**
 * A sign-out a device asks for over its open channel: its row is marked signed out, the pairs
 * parked for it are forgotten and its refresh grant is revoked through the database, as the
 * sign-out route does.
 */

import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'
import { CLOSE } from '@workspace/replica/protocol'

import type { DeviceSessions } from '../../auth/device-sessions'
import { grantIdOf, type IdentitySessions } from '../../auth/identity-sessions'

import { REASON, SERVER_ERROR } from './reasons'

/** How the socket of a device that signed out closes. */
export interface SignOutClose {
  readonly code: number
  readonly reason: string
}

export interface ChannelSignOutDeps {
  readonly sessions: Pick<IdentitySessions, 'unpark'>
  readonly devices: Pick<DeviceSessions, 'signedOut' | 'revokeGrant'>
  readonly log: Logger
}

/**
 * Signs `device` of `identity`, holding refresh key `refresh`, out, and answers how its socket
 * closes: as signed out (4000) once the grant is revoked. A device without a refresh grant (it
 * came with an access token only) has none to revoke. A row that cannot be marked or a grant that
 * cannot be revoked is logged with its code, and the socket closes as a failed server (1011): the
 * device must not take the sign-out close for a revoked grant, and sends the sign-out again
 * through the route, which completes it.
 */
export async function signOutOnChannel(
  deps: ChannelSignOutDeps,
  input: {
    readonly identity: IdentityId
    readonly device: string
    readonly refresh: string | undefined
  },
): Promise<SignOutClose> {
  const { identity, device, refresh } = input
  const grant = refresh === undefined ? undefined : grantIdOf(refresh)
  const signedOut = { code: CLOSE.signedOut, reason: REASON.signedOut }
  const failed = { code: SERVER_ERROR, reason: REASON.revokeFailed }

  if (grant === undefined) {
    deps.log.info({ identity }, 'device signed out without a refresh grant: nothing to revoke')

    return signedOut
  }

  const marked = await deps.devices.signedOut({ identity, grant })

  if (marked.isErr()) {
    deps.log.warn(
      { identity, code: marked.error.code },
      'the row of a device that signed out could not be marked',
    )

    return failed
  }

  deps.sessions.unpark(identity, device)

  const revoked = await deps.devices.revokeGrant({ identity, grant })

  if (revoked.isErr()) {
    deps.log.warn(
      { identity, code: revoked.error.code },
      'the refresh grant of a device that signed out could not be revoked',
    )

    return failed
  }

  return signedOut
}
