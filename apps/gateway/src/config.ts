import { z } from '@workspace/zod'

/** The gateway's environment, parsed once at startup. */
export const gatewayConfig = z.object({
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535),
  /** The database's WebSocket endpoint, such as `ws://127.0.0.1:8000/rpc`: sessions need WebSocket. */
  SURREAL_URL: z.url({
    protocol: /^wss?$/,
    error: 'must be a ws:// or wss:// address: auth sessions need a WebSocket',
  }),
  /** The gateway's namespace user on the database. */
  GATEWAY_SURREAL_USER: z.string().min(1),
  GATEWAY_SURREAL_PASS: z.string().min(1),
  LOG_LEVEL: z.string().optional(),
})

export type GatewayConfig = z.output<typeof gatewayConfig>

/** The namespace every database of the application lives in. */
export const NAMESPACE = 'app'

/** The central database: accounts, and the server's copy of the regions. */
export const DIRECTORY = 'directory'

/**
 * The database's RPC endpoint over plain HTTP for its WebSocket address: `ws` becomes
 * `http`, `wss` becomes `https`, and the path is `/rpc`.
 */
export function httpRpcUrl(surrealUrl: string): string {
  const url = new URL(surrealUrl)

  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/rpc'

  return url.toString()
}
