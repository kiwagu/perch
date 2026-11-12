import { isAPIError } from 'better-auth/api'

import { type DataError, dataError } from '@workspace/data'
import { type DeviceSessionId, type IdentityId, idSchemas } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { AuthInstance } from '../auth-instance'
import { rolesOf } from '../platform-roles'

/**
 * Who a live session belongs to: the identity, its email, the device, the session's row and the
 * account's platform roles.
 */
export interface SessionCaller {
  readonly identity: IdentityId
  readonly email: string
  /** The id the device the session was opened on names itself with. */
  readonly device: string
  /** The session's `device_session` row. */
  readonly session: DeviceSessionId
  /**
   * The account's platform roles as this read found its role: read with the session every time,
   * never kept, so a role granted or taken back counts from the next read.
   */
  readonly roles: readonly PlatformRole[]
}

/**
 * What a session token reads as: a live session and who it belongs to, none (a session waiting for
 * its admission among them), or a failed read.
 */
export type SessionRead =
  | { readonly kind: 'session'; readonly caller: SessionCaller }
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly error: DataError }

/**
 * What Better Auth answers for a live session, as far as the caller is read from it: `pending`, the
 * gateway's own field of the session, which Better Auth answers with the rest of its row, and the
 * account's `role`, the admin plugin's field of the user (none on a row written without it).
 */
const sessionAnswer = z.object({
  session: z.object({
    id: idSchemas.device_session.schema,
    device: deviceId,
    pending: z.boolean(),
  }),
  user: z.object({ id: idSchemas.identity.schema, email: z.string(), role: z.string().nullish() }),
})

const NONE: SessionRead = { kind: 'none' }

/**
 * The headers of a call that carries session token `token` in its raw form; none for a token of
 * another form, which names no session here. A raw token, as a sign-in answers it in its body and
 * as its row holds it, has no `.`. Better Auth also takes the signed form (`<raw>.<signature>`, its
 * `set-auth-token` header), but the gateway ends a session by its raw token, so a device holding
 * the signed one would sign out without ending anything: it is refused at once instead. A token no
 * header can carry (a line break in it) names no session either.
 */
function bearerHeaders(token: string): Headers | undefined {
  if (token.includes('.')) {
    return undefined
  }

  try {
    return new Headers({ authorization: `Bearer ${token}` })
  } catch {
    return undefined
  }
}

/** Whether Better Auth refused the read: the token names no session it serves. */
function refused(cause: unknown): boolean {
  return isAPIError(cause) && (cause.status === 'UNAUTHORIZED' || cause.status === 'FORBIDDEN')
}

/** A read of a session that failed, the database's fault or Better Auth's, not the caller's. */
function failed(cause: unknown): SessionRead {
  return {
    kind: 'failed',
    error: dataError('data:QUERY_FAILED', 'the session could not be read', cause),
  }
}

/**
 * Who the live session that holds `token` belongs to, read through Better Auth, or none: a token
 * nobody holds, one not in its raw form, one whose session ended or expired, or one whose session
 * still waits for its admission (`pending`: a sign-in's or a verification's that the gateway has
 * not admitted, so never handed out, whoever holds its token). The admissions read such a session by
 * their own statements, never here. A session whose row is not of the gateway's shape (its key not
 * a device session id, its identity not an identity id, no device, no `pending`) fails as
 * `data:AUTH_FAILED`.
 */
export async function readSession(auth: AuthInstance, token: string): Promise<SessionRead> {
  const headers = bearerHeaders(token)

  if (headers === undefined) {
    return NONE
  }

  let answer: unknown

  try {
    answer = await auth.api.getSession({ headers })
  } catch (cause) {
    return refused(cause) ? NONE : failed(cause)
  }

  if (answer === null) {
    return NONE
  }

  const parsed = sessionAnswer.safeParse(answer)

  if (!parsed.success) {
    return {
      kind: 'failed',
      error: dataError('data:AUTH_FAILED', 'a session of the directory has an unknown shape'),
    }
  }

  const { session, user } = parsed.data

  if (session.pending) {
    return NONE
  }

  return {
    kind: 'session',
    caller: {
      identity: user.id,
      email: user.email,
      device: session.device,
      session: session.id,
      roles: rolesOf(user.role),
    },
  }
}
