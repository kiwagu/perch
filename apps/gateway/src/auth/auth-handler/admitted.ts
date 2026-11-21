import { match } from 'ts-pattern'

import { idSchemas } from '@workspace/ids'
import { CLOSE, deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { SUPERSEDED } from '../../sync/sync-connection'
import type { AccountStart } from '../account-passwords'
import { DEVICE_HEADER } from '../session-hooks'

import { closeDevice } from './close-device'
import type { AuthMountDeps } from './mount'
import { internal, refused } from './requests'

/**
 * An accepted sign-in's answer as far as the gateway reads it and the device gets it: the raw
 * session token, and the account's id, email, name and whether its email is verified. Nothing else
 * of Better Auth's answer is kept: the account's role and ban (`role`, `banned`, `banReason`,
 * `banExpires`, which the admin plugin adds), its `image`, its language, its timestamps, and
 * `redirect` and `url`, or any field a later version adds.
 */
export const acceptedSession = z.object({
  token: z.string().min(1),
  user: z.object({
    id: idSchemas.identity.schema,
    email: z.string(),
    name: z.string(),
    emailVerified: z.boolean(),
  }),
})

export type AcceptedSession = z.infer<typeof acceptedSession>

/**
 * Admits a sign-in Better Auth accepted (`accepted`, its session written waiting for this
 * admission) against the account's limit of devices (`AuthSessions.admit`, `signOutOldest` its
 * confirmation), and answers the device. One that would bring the account past the limit
 * unconfirmed has its session deleted and answers 409 `device-limit`, nothing signed in, the
 * device's earlier session left as it was; a confirmed one signs out the device seen least
 * recently, whose sockets close with 4003. The admission reads the account's ban in its
 * transaction: a ban that committed after Better Auth's own gate read the account unbanned answers
 * 403 `account-banned`, no token, the new session ended `banned`. An admission that failed answers
 * 500 `internal` and ends the new session by its token; should that ending fail too, the session
 * keeps waiting, counted by no admission, listed nowhere and handed to nobody. An admitted session
 * ends the device's earlier one, so the device's sockets close (`closeDevice`, with the device the
 * request names, the identity admitted and `SUPERSEDED`), and the answer is built here from the
 * allowlist alone, no header of Better Auth's answer copied (its cookies and its `set-auth-token`
 * stay with the gateway): 200 `{ token, user: { id, email, name, emailVerified } }`, with `start`
 * (`{ name, locale }`, what the account signed up with) while the account has not started, which
 * tells the device to start it.
 */
export async function admitted(
  deps: Pick<AuthMountDeps, 'sessions' | 'connections'>,
  request: Request,
  accepted: AcceptedSession,
  start: AccountStart | undefined,
  signOutOldest: boolean,
): Promise<Response> {
  const { token, user } = accepted
  const admission = await deps.sessions.admit(user.id, token, signOutOldest)

  if (admission.isErr()) {
    // The session was never handed to its device: it is ended, and the answer is 500 either way;
    // an ending that failed leaves it waiting for an admission, which nothing counts or lists.
    return (await deps.sessions.signOut(token)).match(internal, internal)
  }

  return match(admission.value)
    .with({ kind: 'asked' }, () => refused(409, 'device-limit'))
    .with({ kind: 'banned' }, () => refused(403, 'account-banned'))
    .with({ kind: 'admitted' }, { kind: 'signed-out' }, async (done) => {
      // The admission ended the device's earlier session: the sockets it opened with it close. A
      // session was written only for a request naming a valid device, which is parsed here.
      const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

      if (device.success) {
        await closeDevice(deps.connections, device.data, user.id, SUPERSEDED)
      }

      if (done.kind === 'signed-out') {
        await deps.connections.close(user.id, done.device, CLOSE.deviceLimit)
      }

      const answer = {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
        },
      }

      return Response.json(
        start === undefined
          ? answer
          : { ...answer, start: { name: start.name, locale: start.locale } },
      )
    })
    .exhaustive()
}
