/**
 * The gateway's HTTP and WebSocket server: health; over HTTP, the device routes, the organisation
 * routes, the invitation routes and the auth mount under `/auth` (Better Auth's sign-up, sign-in,
 * verification and resend, and the gateway's own recovery and changes of a password and an email
 * and deletion of an account), the device routes in front so the two sign-outs under `/auth` are
 * the gateway's own; and the sync connection of each device over a WebSocket at `/sync`.
 */

import type { DataError } from '@workspace/data'
import { ExceptionBase } from '@workspace/kernel'
import { createLogger } from '@workspace/logger'

import { authHandler } from './auth/auth-handler'
import { deviceRoutes } from './auth/device.routes'
import type { GatewayRoot } from './composition/root'
import { clientAddress } from './limits/client-address'
import { SyncConnection } from './sync/sync-connection'
import { invitationRoutes } from './tenants/invitation-routes'
import { organisationRoutes } from './tenants/organisation-routes'

export interface ServerOptions {
  /** The port to listen on; 0 lets the system choose a free one. */
  readonly port: number
  readonly hostname: string
}

export interface RunningServer {
  /** The port the server listens on, also when the system chose it. */
  readonly port: number
  /** Stops listening and closes every open connection. */
  stop(): Promise<void>
}

/** What the server keeps on each WebSocket: the device's sync connection, once it opened. */
interface SocketData {
  connection?: SyncConnection
}

/**
 * The largest request body the server reads: a body is a sign-up's name, email and password, a
 * sign-in's email and password, a link's token, an email to send a link to again, a password with
 * a new password or a new email, an organisation's key and name, an email to invite with its role,
 * an invitation's token or id, or a member's new role.
 */
const MAX_REQUEST_BODY = 16 * 1024

/** The largest WebSocket message: a push of the most updates a push may carry, of ordinary size. */
const MAX_MESSAGE = 4 * 1024 * 1024

/**
 * An HTTP route: its answer to a request from the client address `from`, or `undefined` for a
 * path that is not its own.
 */
type Route = (request: Request, from: string) => Promise<Response | undefined>

/** The answer of the first route that answers the request, the routes asked in their order. */
async function firstAnswer(
  routes: readonly Route[],
  request: Request,
  from: string,
): Promise<Response | undefined> {
  for (const route of routes) {
    const response = await route(request, from)

    if (response) {
      return response
    }
  }

  return undefined
}

/** A server bound to a host and a port that reports no port. */
class ServerPortException extends ExceptionBase {
  readonly code = 'gateway:NO_PORT'
}

export function startServer(root: GatewayRoot, options: ServerOptions): RunningServer {
  const httpLog = createLogger('http')
  const syncLog = createLogger('sync')
  // The code and the gateway's own message, never the cause: a database's text may hold anything.
  const onFailure = (error: DataError) => httpLog.error({ code: error.code }, error.message)
  // The device routes come first: `POST /auth/sign-out` and `POST /auth/sign-out-everywhere` are
  // theirs; the auth mount answers every other path under `/auth/`, handing Better Auth only its
  // sign-up, sign-in, verification and resend, and answering the recovery and the changes of a
  // password and an email and the deletion of an account itself.
  const routes: readonly Route[] = [
    deviceRoutes(root.sessions, root.deviceSessions, root.connections, {
      onFailure,
      clock: root.clock,
    }),
    organisationRoutes(root.sessions, root.organisations, {
      onFailure,
      limits: root.limits,
      clock: root.clock,
    }),
    invitationRoutes(root.sessions, root.organisations, { onFailure, limits: root.limits }),
    authHandler({
      auth: root.auth,
      sessions: root.sessions,
      passwords: root.passwords,
      resets: root.resets,
      emailChanges: root.emailChanges,
      deletions: root.deletions,
      departure: root.departure,
      teardown: root.teardown,
      mails: root.mails,
      profiles: root.profiles,
      limits: root.limits,
      connections: root.connections,
      clock: root.clock,
      accounts: root.accountTurns,
    }),
  ]
  const server = Bun.serve<SocketData, never>({
    port: options.port,
    hostname: options.hostname,
    maxRequestBodySize: MAX_REQUEST_BODY,
    async fetch(request, bun) {
      const { pathname } = new URL(request.url)

      if (pathname === '/health') {
        return new Response('ok')
      }

      if (pathname === '/sync') {
        return bun.upgrade(request, { data: {} })
          ? undefined
          : new Response('upgrade required', { status: 426 })
      }

      // The front's X-Forwarded-For names the client; a request without one comes from its peer.
      const from = clientAddress(request, bun.requestIP(request)?.address)
      const response = await firstAnswer(routes, request, from)

      if (!response) {
        return new Response('not found', { status: 404 })
      }

      // The routes answer a failure without its cause, which may name a token.
      if (response.status >= 500) {
        httpLog.error({ status: response.status, path: pathname }, 'a request failed')
      }

      return response
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE,
      // A device too slow to take what it is sent is closed rather than silently skipped: it
      // connects again and its subscription brings everything it lacks.
      closeOnBackpressureLimit: true,
      open(socket) {
        socket.data.connection = new SyncConnection(socket, {
          sessions: root.sessions,
          devices: root.deviceSessions,
          hub: root.hub,
          schema: root.schema,
          organisations: root.organisations,
          profiles: root.profiles,
          connections: root.connections,
          clock: root.clock,
          log: syncLog,
        })
      },
      async message(socket, text) {
        await socket.data.connection?.receive(
          typeof text === 'string' ? text : new TextDecoder().decode(text),
        )
      },
      close(socket) {
        socket.data.connection?.closed()
      },
    },
  })
  const { port } = server

  if (port === undefined) {
    void server.stop(true)

    throw new ServerPortException(`the server on ${options.hostname} reports no port`)
  }

  return { port, stop: () => server.stop(true) }
}
