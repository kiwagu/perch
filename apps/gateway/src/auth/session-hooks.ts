import type { BetterAuthOptions, GenericEndpointContext, Session } from 'better-auth'
import { APIError } from 'better-auth/api'

import type { LocalDb } from '@workspace/data'
import type { Clock } from '@workspace/replica'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import sessionEndByTokenStatement from './surql/device-session-end-by-token.surql'
import sessionsKeepNewestStatement from './surql/device-sessions-keep-newest.surql'

export const DEVICE_HEADER = 'X-Perch-Device'

export const DEVICE_LABEL_HEADER = 'X-Perch-Device-Label'

/**
 * Set to `pending` by the gateway's sign-in route on the request it hands Better Auth, whatever
 * the client sent: the session that sign-in writes waits for its admission against the account's
 * limit of devices. Read on Better Auth's sign-in path only; a verification's session waits for
 * its own admission whatever its request names, and no other way in writes a session that waits.
 */
export const ADMISSION_HEADER = 'X-Perch-Admission'

const label = z.string().max(60)

type SessionRow = Session & Record<string, unknown>

/** The headers of the request a hook runs for; a server-side call without a request has none. */
function headersOf(ctx: GenericEndpointContext | null): Headers | undefined {
  return ctx?.headers ?? ctx?.request?.headers
}

/** Better Auth's path of a sign-in by email and password, whose session the gateway admits. */
const BETTER_AUTH_SIGN_IN_PATH = '/sign-in/email'

/**
 * Better Auth's path of the verification of an email, whose session the gateway admits too: the
 * mount reaches it only through the gateway's verification (`/change-email`, whose links would
 * sign in there as well, is switched off).
 */
const BETTER_AUTH_VERIFY_PATH = '/verify-email'

/**
 * Better Auth's `databaseHooks.session`: a session is created at a sign-in and at the first
 * verification of an email. Better Auth runs the admin plugin's hook first, which refuses a banned
 * account's session (403 `BANNED_USER`), so the creation hooks here run only for an account the
 * plugin read unbanned. Before
 * the row exists, the device the request names (`X-Perch-Device`, 1 to 64 characters) and its
 * label (`X-Perch-Device-Label`, at most 60) go into it; a request without a valid device is
 * refused 400 `bad-request`, as the routes refuse it. A sign-in's row is written `pending` when the
 * gateway's sign-in route asks for it (`ADMISSION_HEADER`): the gateway admits it against the
 * account's limit of devices before it hands it out (`AuthSessions.admit`). A verification's row
 * is always written `pending`: the gateway admits it before it hands it out
 * (`AuthSessions.admitVerified`), each admission reading the account's ban in its transaction,
 * so a ban that commits after the plugin's read is still seen. After a row admitted as it is
 * written exists (a sign-in's that Better Auth's own API wrote, without the gateway's route), the
 * identity's admitted sessions on the same device but the newest one end (the newest: created
 * last, of the greater id among those created at the same instant), and each admission does the
 * same in its transaction: a device holds one live session. Each keeps the newest, its own row
 * included when a newer one exists already, so the device converges on its newest session whatever
 * order the rows are inserted and the statements run in: a session whose row is inserted late ends
 * itself, and two that end the others at once never end each other. A row that waits for its
 * admission is neither kept nor ended, so the device's earlier session stays live until the
 * sign-in or the verification is admitted, and as it was when it is not.
 *
 * A session row is ended, never deleted, so a device signed out from another one stays listed
 * with the moment it ended. Better Auth deletes the row at sign-out and when it reads a session
 * that has expired; instead, the delete ends the row and is refused: a live row at once, an
 * expired one at its expiry, so no late extension of it takes hold. This guards one row at a time
 * only: a delete of several rows at once stops at the first refusal and ends at most one row,
 * possibly none (the first may be one that already ended), so Better Auth's bulk revocations are
 * switched off where the instance is built.
 *
 * Both endings are the gateway's own statements on `directory`, the connection Better Auth's
 * adapter runs on, as every other ending is: each sets `ended_at` with `expires_at` and never
 * moves an ending that is there. Better Auth's adapter would drop `ended_at`, a column outside
 * its model, and cannot say "keep an existing end" or "all but the newest".
 */
export function sessionHooks(clock: Clock, directory: LocalDb) {
  return {
    create: {
      before: async (session: SessionRow, ctx: GenericEndpointContext | null) => {
        const headers = headersOf(ctx)
        const device = deviceId.safeParse(headers?.get(DEVICE_HEADER))

        if (!device.success) {
          throw new APIError('BAD_REQUEST', {
            code: 'bad-request',
            message: 'the request names no device',
          })
        }

        const parsedLabel = label.safeParse(headers?.get(DEVICE_LABEL_HEADER) ?? '')

        return {
          data: {
            ...session,
            device: device.data,
            label: parsedLabel.success ? parsedLabel.data : '',
            pending:
              ctx?.path === BETTER_AUTH_VERIFY_PATH ||
              (ctx?.path === BETTER_AUTH_SIGN_IN_PATH &&
                headers?.get(ADMISSION_HEADER) === 'pending'),
          },
        }
      },
      after: async (session: SessionRow) => {
        const device = session['device']

        // A row that waits for its admission ends nothing yet: its admission keeps the device's
        // newest session, so a sign-in asked about the limit, or a verification refused, leaves
        // the device as it was.
        if (typeof device !== 'string' || session['pending'] === true) {
          return
        }

        await directory.db
          .query(sessionsKeepNewestStatement, {
            identity: session.userId,
            device,
            ended_at: new Date(clock.now()),
          })
          .retry()
      },
    },
    delete: {
      before: async (session: SessionRow) => {
        await directory.db
          .query(sessionEndByTokenStatement, {
            session_token: session.token,
            ended_at: new Date(clock.now()),
          })
          .retry()

        return false
      },
    },
  } satisfies NonNullable<NonNullable<BetterAuthOptions['databaseHooks']>['session']>
}
