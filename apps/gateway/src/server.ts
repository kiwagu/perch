/**
 * The gateway's HTTP and WebSocket server: health, sign-up, sign-in and the organisation routes
 * over HTTP, and the sync connection of each device over a WebSocket at `/sync`.
 */

import { ExceptionBase } from '@workspace/kernel'
import { createLogger } from '@workspace/logger'

import { authRoutes } from './auth/auth.routes'
import type { GatewayRoot } from './composition/root'
import { SyncConnection } from './sync/sync-connection'
import { organisationRoutes } from './tenants/organisation.routes'

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
 * The largest request body the server reads: a body is an email and a password, an
 * organisation's key and name, or an email.
 */
const MAX_REQUEST_BODY = 16 * 1024

/** The largest WebSocket message: a push of the most updates a push may carry, of ordinary size. */
const MAX_MESSAGE = 4 * 1024 * 1024

/** An HTTP route: its answer to a request, or `undefined` for a path that is not its own. */
type Route = (request: Request) => Promise<Response | undefined>

/** The answer of the first route that answers the request. */
async function firstAnswer(
  routes: readonly Route[],
  request: Request,
): Promise<Response | undefined> {
  for (const route of routes) {
    const response = await route(request)

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
  const routes = [
    authRoutes(root.sessions, root.organisations),
    organisationRoutes(root.sessions, root.organisations, {
      // The code and the gateway's own message, never the cause: a database's text may hold anything.
      onFailure: (error) => httpLog.error({ code: error.code }, error.message),
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

      const response = await firstAnswer(routes, request)

      if (!response) {
        return new Response('not found', { status: 404 })
      }

      // The routes answer a failure without its cause, which may name a key.
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
          hub: root.hub,
          organisations: root.organisations,
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
