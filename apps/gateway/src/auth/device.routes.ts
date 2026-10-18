import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { CLOSE, deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { ConnectionRegistry } from '../sync/connections'

import { bearerCaller, DEVICE_HEADER, readBody } from './auth.routes'
import type { DeviceSessionRow, DeviceSessions, SignOutError } from './device-sessions'
import { grantIdOf, type IdentitySessions } from './identity-sessions'

/**
 * What a device sends to have its pair revoked: the pair itself, which is the credential, so its
 * access token need not work any more.
 */
const signOutBody = z.object({ access: z.string().min(1), refresh: z.string().min(1) })

/** The paths of the device routes: every device of the caller, one of them, and the sign-outs. */
const DEVICE_PATH = /^\/devices(?:\/([^/]+))?$/

/** What a path names. */
type Target =
  | { readonly kind: 'devices' }
  | { readonly kind: 'device'; readonly id: string }
  | { readonly kind: 'everywhere' }
  | { readonly kind: 'sign-out' }

/** Who a call with an access token comes from: the identity and its device, whose session is live. */
interface Caller {
  readonly identity: IdentityId
  readonly device: string
}

/** Answers a request of the caller. */
type Handler = (caller: Caller, request: Request) => Promise<Response>

/**
 * A device as the caller's list shows it. The grant it holds and the browser's own id stay on the
 * server: a hello binds by that id, so a live access token must not learn the other devices' ids.
 */
interface ListedDevice {
  readonly id: string
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

function listed(row: DeviceSessionRow, current: string): ListedDevice {
  return {
    id: row.id,
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

const badRequest = (): Response => Response.json({ code: 'bad-request' }, { status: 400 })

export interface DeviceRoutesOptions {
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
}

/**
 * The device routes over HTTP, for the identity the device's access token signs in
 * (`Authorization: Bearer <access>`) on the device it names in `X-Perch-Device`, whose session
 * must be live.
 *
 * - `GET /devices`: 200 `{ devices }`, the caller's devices the earliest first, those signed out
 *   within the last 30 days among them, each with `current` when it is the device the request
 *   came from; a device's own id (the one its header names) is never sent.
 * - `DELETE /devices/:id`: 204 once the device is signed out: its row and its grant revoked, a
 *   pair parked for it forgotten and its sockets closed with 4001; 404 `no-such-device` for an id
 *   that is not one of the caller's devices.
 * - `POST /auth/sign-out-everywhere`: 204 once every device of the caller, the asking one
 *   included, is signed out: the tokens issued before refused, every grant and row revoked, every
 *   parked pair forgotten and every socket closed with 4001.
 * - `POST /auth/sign-out` `{ access, refresh }` from the device named in `X-Perch-Device`, without
 *   `Authorization`: the pair itself is the credential, and its access token need not work any
 *   more. The pair must sign an identity in (renewed when its access token no longer works) and
 *   its refresh grant must be one of the identity's devices: that device's row is marked signed
 *   out (or stays so), a pair parked for it is forgotten, its sockets are closed with 4001, and
 *   the grant the pair holds (the renewed one when renewed) is revoked through the database: 204.
 *   A failure answers 500 and may be asked again; a pair that signs nobody in or that no device
 *   of the identity holds answers 401 `unauthorized`, with nothing revoked but a grant the route
 *   renewed itself.
 *
 * A sign-out that failed after its first write still forgets the parked pairs and closes the
 * sockets of what it signed out before it answers 500. A method a path does not take answers 405
 * with the one it does in `Allow`; a request whose token signs nobody in or whose device has no
 * live session, 401 `unauthorized`; a request that names no device or a body that does not
 * follow its schema, 400 `bad-request`; a failure of the gateway, 500 `internal`, the failure
 * itself handed to `onFailure`. A request for another path is not answered here (`undefined`).
 */
export function deviceRoutes(
  sessions: Pick<IdentitySessions, 'authenticate' | 'unpark'>,
  devices: Pick<
    DeviceSessions,
    'bind' | 'list' | 'revoke' | 'revokeGrant' | 'revokeAll' | 'signedOut'
  >,
  connections: Pick<ConnectionRegistry, 'close'>,
  options: DeviceRoutesOptions,
): (request: Request) => Promise<Response | undefined> {
  /** A failure of the gateway answers without its cause, which `onFailure` hears. */
  function failed(error: DataError): Response {
    options.onFailure(error)

    return Response.json({ code: 'internal' }, { status: 500 })
  }

  /** Forgets the pairs parked for what was signed out and closes its sockets with 4001. */
  async function signedOut(identity: IdentityId, device: string | undefined): Promise<void> {
    sessions.unpark(identity, device)
    await connections.close(identity, device, CLOSE.revoked)
  }

  /** A sign-out that failed: before its first write, or after it (`partial`). */
  function dataErrorOf(error: SignOutError): DataError {
    return 'kind' in error ? error.error : error
  }

  const list: Handler = async ({ identity, device }) =>
    (await devices.list(identity)).match(
      (rows) => Response.json({ devices: rows.map((row) => listed(row, device)) }),
      failed,
    )

  const revoke =
    (id: string): Handler =>
    async ({ identity }) => {
      const parsed = idSchemas.device_session.schema.safeParse(id)

      // An id of another form names no device.
      if (!parsed.success) {
        return noSuchDevice()
      }

      const revoked = await devices.revoke({ identity, id: parsed.data })

      if (revoked.isErr()) {
        const failure = revoked.error

        // The row was marked before the grant failed: the device is closed all the same.
        if ('kind' in failure && failure.row) {
          await signedOut(identity, failure.row.device)
        }

        return failed(dataErrorOf(failure))
      }

      const row = revoked.value

      if (row === undefined) {
        return noSuchDevice()
      }

      await signedOut(identity, row.device)

      return noContent()
    }

  const everywhere: Handler = async ({ identity }) => {
    const revoked = await devices.revokeAll(identity)

    if (revoked.isErr()) {
      // The tokens were refused before the rest failed: every device is closed all the same.
      if ('kind' in revoked.error) {
        await signedOut(identity, undefined)
      }

      return failed(dataErrorOf(revoked.error))
    }

    await signedOut(identity, undefined)

    return noContent()
  }

  /**
   * The pair is the credential: it signs the identity in (renewed when its access token no
   * longer works), and its grant names the device. The row is marked first, then the grant the
   * pair holds now is revoked through the database; both may be asked again. A renewal that ends
   * in anything but 204 still has its grant revoked: nobody holds that pair.
   */
  const signOut = async (request: Request): Promise<Response> => {
    const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))
    const body = signOutBody.safeParse(await readBody(request))

    if (!device.success || !body.success) {
      return badRequest()
    }

    const { access, refresh } = body.data
    const sent = grantIdOf(refresh)
    const authenticated = await sessions.authenticate({ access, refresh })

    if (authenticated.isErr() || sent === undefined) {
      return unauthorized()
    }

    const { identity } = authenticated.value
    const renewed = authenticated.value.renewed
      ? grantIdOf(authenticated.value.tokens.refresh)
      : undefined
    /** Answers, once a renewed grant that is not revoked yet has been. */
    const answer = async (response: Response): Promise<Response> => {
      if (renewed !== undefined && response.status !== 204) {
        // A grant still live is reported as a failure of its own; the answer stands.
        await devices
          .revokeGrant({ identity: identity.id, grant: renewed })
          .match(() => undefined, options.onFailure)
      }

      return response
    }
    const marked = await devices.signedOut({ identity: identity.id, grant: sent })

    if (marked.isErr()) {
      return answer(failed(marked.error))
    }

    // No device of the identity holds the pair's grant: nothing is revoked for it.
    if (marked.value === undefined) {
      return answer(unauthorized())
    }

    await signedOut(identity.id, marked.value.device)

    // The spent grant of a renewal is dead already: the renewed one is the pair's now.
    const revoked = await devices.revokeGrant({ identity: identity.id, grant: renewed ?? sent })

    return revoked.isOk() ? noContent() : answer(failed(revoked.error))
  }

  /** Answers with the handler once the request's access token and device name a live session. */
  const signedIn =
    (handler: Handler) =>
    async (request: Request): Promise<Response> => {
      const caller = await bearerCaller(sessions, devices, request)

      return match(caller)
        .with({ kind: 'caller' }, ({ identity, device }) => handler({ identity, device }, request))
        .with({ kind: 'unauthorized' }, async () => unauthorized())
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
