import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'

import type { AuthSessions } from './auth-sessions'
import { DEVICE_HEADER } from './session-hooks'

/** The header a device names itself in on every call with a session token. */
export { DEVICE_HEADER }

/** The session token in an `Authorization` header. */
const BEARER = /^Bearer +(\S+)$/i

/**
 * Who a call with a session token comes from: the identity whose live session the token holds,
 * the device it names, which the session was opened on, and the token; or why the call is
 * refused.
 */
export type BearerCaller =
  | {
      readonly kind: 'caller'
      readonly identity: IdentityId
      readonly device: string
      readonly token: string
    }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'failed'; readonly error: DataError }

/** The session token the request carries as `Authorization: Bearer <token>`, if it does. */
export function bearerToken(request: Request): string | undefined {
  return BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
}

/**
 * Who the request comes from: the device it names in `X-Perch-Device` must follow the protocol's
 * device id (checked first, before any session is read), its session token must hold a live
 * session, and that session must have been opened on the device the request names: a token
 * carried to another device is refused. A session that could not be read is no refusal: the call
 * failed.
 */
export async function bearerCaller(
  sessions: Pick<AuthSessions, 'read'>,
  request: Request,
): Promise<BearerCaller> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (!device.success) {
    return { kind: 'bad-request' }
  }

  const token = bearerToken(request)

  if (token === undefined) {
    return { kind: 'unauthorized' }
  }

  const read = await sessions.read(token)

  if (read.kind === 'failed') {
    return { kind: 'failed', error: read.error }
  }

  return read.kind === 'session' && read.caller.device === device.data
    ? { kind: 'caller', identity: read.caller.identity, device: device.data, token }
    : { kind: 'unauthorized' }
}

/**
 * The answer to a call whose session token holds no live session, or one of another device:
 * 401 `unauthorized`, naming the scheme the call must authenticate with.
 */
export function bearerRefused(): Response {
  return Response.json(
    { code: 'unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  )
}
