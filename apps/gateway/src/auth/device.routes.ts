import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { ConnectionRegistry } from '../sync/connections'

import { bearerIdentity, bearerToken, readBody } from './auth.routes'
import type { DeviceSessionRow, DeviceSessions } from './device-sessions'
import type { IdentitySessions } from './identity-sessions'

/** The header a device names itself in on the device routes. */
export const DEVICE_HEADER = 'X-Perch-Device'

/** What a device sends to have its pair revoked: the refresh key; the access token goes as Bearer. */
const signOutBody = z.object({ refresh: z.string().min(1) })

/** The paths of the device routes: every device of the caller, one of them, and the sign-outs. */
const DEVICE_PATH = /^\/devices(?:\/([^/]+))?$/

/** What a path names. */
type Target =
  | { readonly kind: 'devices' }
  | { readonly kind: 'device'; readonly id: string }
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'sign-out' }

/** Answers a request of the identity its access token signs in. */
type Handler = (identity: IdentityId, request: Request) => Promise<Response>

/** A device as the caller's list shows it; the grant it holds stays on the server. */
interface ListedDevice {
  readonly id: string
  readonly device: string
  readonly label: string
  readonly createdAt: string
  readonly lastSeenAt: string
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

function listed(row: DeviceSessionRow, current: string | null): ListedDevice {
  return {
    id: row.id,
    device: row.device,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    current: row.device === current,
  }
}

const noContent = (): Response => new Response(null, { status: 204 })

const unauthorized = (): Response => Response.json({ code: 'unauthorized' }, { status: 401 })

const noSuchDevice = (): Response => Response.json({ code: 'no-such-device' }, { status: 404 })

export interface DeviceRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
}

/**
 * The device routes over HTTP, for the identity the device's access token signs in
 * (`Authorization: Bearer <access>`); a device names itself in the `X-Perch-Device` header.
 *
 * - `GET /devices`: 200 `{ devices }`, the caller's devices the earliest first, those signed out
 *   from another device within the last 30 days among them, each with `current` when it is the
 *   device the request came from.
 * - `DELETE /devices/:id`: 204 once the device is signed out: its grant revoked, a pair parked
 *   for it forgotten and its sockets closed with 4001; 404 `no-such-device` for an id that is
 *   not one of the caller's devices.
 * - `POST /auth/sign-out-everywhere`: 204 once every device of the caller, the asking one
 *   included, is signed out: the tokens issued before refused, every grant revoked and every
 *   socket closed with 4001.
 * - `POST /auth/sign-out` `{ refresh }`: 204 once the pair of the Bearer access token and the
 *   refresh key is revoked through the database's RPC, which judges the pair: an access token
 *   that no longer works is taken, a pair it refuses answers 401 `unauthorized`, and a database
 *   that could not judge it 500.
 *
 * A method a path does not take answers 405 with the one it does in `Allow`; a request whose
 * token signs nobody in, 401 `unauthorized`; a body that does not follow its schema, 400
 * `bad-request`; a failure of the gateway, 500 `internal`, the failure itself handed to
 * `onFailure`. A request for another path is not answered here (`undefined`).
 */
export function deviceRoutes(
  sessions: Pick<IdentitySessions, 'authenticate' | 'revoke' | 'unpark'>,
  devices: Pick<DeviceSessions, 'list' | 'revoke' | 'revokeAll'>,
  connections: Pick<ConnectionRegistry, 'close'>,
  options: DeviceRoutesOptions,
): (request: Request) => Promise<Response | undefined> {
  /** A failure of the gateway answers without its cause, which `onFailure` hears. */
  function failed(error: DataError): Response {
    options.onFailure(error)

    return Response.json({ code: 'internal' }, { status: 500 })
  }

  const list: Handler = async (identity, request) => {
    const current = request.headers.get(DEVICE_HEADER)

    return (await devices.list(identity)).match(
      (rows) => Response.json({ devices: rows.map((row) => listed(row, current)) }),
      failed,
    )
  }

  const revoke =
    (id: string): Handler =>
    async (identity) => {
      const parsed = idSchemas.device_session.schema.safeParse(id)

      // An id of another form names no device.
      if (!parsed.success) {
        return noSuchDevice()
      }

      const revoked = await devices.revoke({ identity, id: parsed.data })

      if (revoked.isErr()) {
        return failed(revoked.error)
      }

      const row = revoked.value

      if (row === undefined) {
        return noSuchDevice()
      }

      sessions.unpark(row.device)
      await connections.close(identity, row.device, CLOSE.revoked)

      return noContent()
    }

  const everywhere: Handler = async (identity) => {
    const revoked = await devices.revokeAll(identity)

    if (revoked.isErr()) {
      return failed(revoked.error)
    }

    await connections.close(identity, undefined, CLOSE.revoked)

    return noContent()
  }

  /** The pair is the database's to judge: its access token need not work any more. */
  const signOut = async (request: Request): Promise<Response> => {
    const access = bearerToken(request)

    if (access === undefined) {
      return unauthorized()
    }

    const body = signOutBody.safeParse(await readBody(request))

    if (!body.success) {
      return Response.json({ code: 'bad-request' }, { status: 400 })
    }

    const revoked = await sessions.revoke({ access, refresh: body.data.refresh })

    if (revoked.isOk()) {
      return noContent()
    }

    // Only a pair the database refused is dead; one it never judged may be revoked later.
    return revoked.error.code === 'data:AUTH_FAILED' ? unauthorized() : failed(revoked.error)
  }

  /** Answers with the handler once the request's access token signs an identity in. */
  const signedIn =
    (handler: Handler) =>
    async (request: Request): Promise<Response> => {
      const identity = await bearerIdentity(sessions, request)

      return identity === undefined ? unauthorized() : handler(identity, request)
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
