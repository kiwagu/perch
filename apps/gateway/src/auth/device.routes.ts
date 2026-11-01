import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { CLOSE, deviceId } from '@workspace/replica/protocol'

import type { ConnectionRegistry } from '../sync/connections'

import type { AuthSessions } from './auth-sessions'
import { bearerCaller, bearerRefused, bearerToken, DEVICE_HEADER } from './bearer-caller'
import { type DeviceSessionRow, endedAt } from './device-session-rows'
import type { DeviceSessions } from './device-sessions'

/** The paths of the device routes: every device of the caller, and one of them. */
const DEVICE_PATH = /^\/devices(?:\/([^/]+))?$/

/** What a path names. */
type Target =
  | { readonly kind: 'devices' }
  | { readonly kind: 'device'; readonly id: string }
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'sign-out' }

/** Who a call with a session token comes from: the identity, and the device of its live session. */
interface Caller {
  readonly identity: IdentityId
  readonly device: string
}

/** Answers a call of the caller. */
type Handler = (caller: Caller) => Promise<Response>

/**
 * A device as the caller's list shows it. The session token it holds and the id it names itself
 * with stay on the server: a token is the session itself, and a device's id is what its calls
 * name it by.
 */
interface ListedDevice {
  readonly id: string
  readonly label: string
  readonly createdAt: string
  readonly lastSeenAt: string
  /** When the device's session ended; null while it is live. */
  readonly revokedAt: string | null
  /** The device the request came from. */
  readonly current: boolean
}

function targetOf(pathname: string): Target | undefined {
  if (pathname === '/auth/sign-out-everywhere') {
    return { kind: 'everywhere' }
  }

  if (pathname === '/auth/sign-out') {
    return { kind: 'sign-out' }
  }

  const found = DEVICE_PATH.exec(pathname)

  if (!found) {
    return undefined
  }

  const [, id] = found

  return id === undefined ? { kind: 'devices' } : { kind: 'device', id }
}

/** `row` as the list of `current`'s identity shows it at `now` (ms since the epoch). */
function listed(row: DeviceSessionRow, current: string, now: number): ListedDevice {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    revokedAt: endedAt(row, now)?.toISOString() ?? null,
    current: row.device === current,
  }
}

const noContent = (): Response => new Response(null, { status: 204 })

const noSuchDevice = (): Response => Response.json({ code: 'no-such-device' }, { status: 404 })

const badRequest = (): Response => Response.json({ code: 'bad-request' }, { status: 400 })

export interface DeviceRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
  /** When a device's session reads as ended, for the list and the sign-out. */
  readonly clock: Clock
}

/**
 * The device routes over HTTP, for the identity whose live session the device's token holds
 * (`Authorization: Bearer <token>`, the raw session token) on the device it names in
 * `X-Perch-Device`, which must be the device the session was opened on. They sit in front of
 * Better Auth's handler, so the two sign-outs under `/auth/` are served here; a session is ended
 * by the gateway's own update of its row, never deleted, so its device stays listed.
 *
 * - `GET /devices`: 200 `{ devices }`, the latest session of each of the caller's devices, the
 *   earliest device first, those signed out within the last 30 days among them, each with
 *   `revokedAt` (when its session ended, or null) and `current` when it is the device the request
 *   came from; neither a session token nor a device's own id is ever sent.
 * - `DELETE /devices/:id`: 204 once session `:id` of the caller has ended and its device's
 *   sockets are closed with 4001; a session that ended already answers 204 with nothing closed,
 *   so the device's later session keeps its sockets; 404 `no-such-device` for an id that is not
 *   one of the caller's sessions.
 * - `POST /auth/sign-out-everywhere`: 204 once every live session of the caller, the asking
 *   one included, has ended and every socket of the identity is closed with 4001.
 * - `POST /auth/sign-out`, with the device's token and its `X-Perch-Device` and no body: the token
 *   itself is the credential, so a session the device holds can be ended whatever state it is
 *   in. 204 once the session that holds it has ended and that device's sockets are closed with
 *   4001; a session that ended already answers 204, nothing closed again; a token no session
 *   holds, or one whose session is of another device than the request names, answers 401
 *   `unauthorized`. A failure answers 500 and the device keeps its token to ask again.
 *
 * A method a path does not take answers 405 with the one it does in `Allow`; a request whose
 * token holds no live session, or one of another device, 401 `unauthorized` with
 * `WWW-Authenticate: Bearer`; a request that names no valid device, 400 `bad-request`, before any
 * token is read; a failure of the gateway or a session that could not be read, 500 `internal`,
 * the failure itself handed to `onFailure` and nothing closed. A request for another path is not
 * answered here (`undefined`).
 */
export function deviceRoutes(
  sessions: Pick<AuthSessions, 'read' | 'signOut' | 'revoke' | 'revokeAll'>,
  devices: Pick<DeviceSessions, 'list' | 'byToken'>,
  connections: Pick<ConnectionRegistry, 'close'>,
  options: DeviceRoutesOptions,
): (request: Request, from: string) => Promise<Response | undefined> {
  /** A failure of the gateway answers without its cause, which `onFailure` hears. */
  function failed(error: DataError): Response {
    options.onFailure(error)

    return Response.json({ code: 'internal' }, { status: 500 })
  }

  const list: Handler = async ({ identity, device }) => {
    const now = options.clock.now()

    return (await devices.list(identity)).match(
      (rows) => Response.json({ devices: rows.map((row) => listed(row, device, now)) }),
      failed,
    )
  }

  const revoke =
    (id: string): Handler =>
    async ({ identity }) => {
      const parsed = idSchemas.device_session.schema.safeParse(id)

      // An id of another form names no session.
      if (!parsed.success) {
        return noSuchDevice()
      }

      const revoked = await sessions.revoke(identity, parsed.data)

      if (revoked.isErr()) {
        return failed(revoked.error)
      }

      const ending = revoked.value

      if (ending.kind === 'missing') {
        return noSuchDevice()
      }

      // Only a session this call ended closes its device's sockets: once it had ended, the device
      // may have signed in again, and its new session's sockets are not this one's.
      if (ending.kind === 'ended') {
        await connections.close(identity, ending.row.device, CLOSE.revoked)
      }

      return noContent()
    }

  const everywhere: Handler = async ({ identity }) => {
    const revoked = await sessions.revokeAll(identity)

    if (revoked.isErr()) {
      return failed(revoked.error)
    }

    await connections.close(identity, undefined, CLOSE.revoked)

    return noContent()
  }

  /**
   * The token names the session to end, live or not: its row is looked up by the token, so a
   * token no row holds, or one whose row is of another device than the request names, answers
   * 401. The session is then ended by its token whatever its state, which marks an expired one
   * ended at its expiry so no late extension of it takes hold, and answers 204. Only a session
   * this call ended while it was live closes the device's sockets: one that had expired or ended
   * already may have been followed by a new session of the device, whose sockets are not its own.
   */
  const signOut = async (request: Request): Promise<Response> => {
    const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

    if (!device.success) {
      return badRequest()
    }

    const token = bearerToken(request)

    if (token === undefined) {
      return bearerRefused()
    }

    const found = await devices.byToken(token)

    if (found.isErr()) {
      return failed(found.error)
    }

    const row = found.value

    if (row === undefined || row.device !== device.data) {
      return bearerRefused()
    }

    const ended = await sessions.signOut(token)

    if (ended.isErr()) {
      return failed(ended.error)
    }

    if (ended.value === 'ended') {
      await connections.close(row.identity, row.device, CLOSE.revoked)
    }

    return noContent()
  }

  /** Answers with the handler once the request's token and device name a live session. */
  const signedIn =
    (handler: Handler) =>
    async (request: Request): Promise<Response> => {
      const caller = await bearerCaller(sessions, request)

      return match(caller)
        .with({ kind: 'caller' }, ({ identity, device }) => handler({ identity, device }))
        .with({ kind: 'unauthorized' }, async () => bearerRefused())
        .with({ kind: 'bad-request' }, async () => badRequest())
        .with({ kind: 'failed' }, async ({ error }) => failed(error))
        .exhaustive()
    }

  /** The one method the target takes, and its handler. */
  function handlerOf(target: Target): readonly [string, (request: Request) => Promise<Response>] {
    return match(target)
      .with({ kind: 'devices' }, () => ['GET', signedIn(list)] as const)
      .with({ kind: 'device' }, ({ id }) => ['DELETE', signedIn(revoke(id))] as const)
      .with({ kind: 'everywhere' }, () => ['POST', signedIn(everywhere)] as const)
      .with({ kind: 'sign-out' }, () => ['POST', signOut] as const)
      .exhaustive()
  }

  return async (request) => {
    const target = targetOf(new URL(request.url).pathname)

    if (!target) {
      return undefined
    }

    const [method, handler] = handlerOf(target)

    if (request.method !== method) {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: method } },
      )
    }

    return handler(request)
  }
}
