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
  /**
   * The key the identity access method signs tokens with, given to the directory schema at
   * apply: a schema applied again with it keeps every issued token valid. Required, with no
   * default; a new value signs no device out: each renews once with its refresh key.
   */
  GATEWAY_JWT_KEY: z
    .string()
    .min(64, { error: 'must be at least 64 characters, such as openssl rand -hex 64' }),
  LOG_LEVEL: z.string().optional(),
})

export type GatewayConfig = z.output<typeof gatewayConfig>

/** The namespace every database of the application lives in. */
export const NAMESPACE = 'app'

/** The central database: accounts, and the server's copy of the regions. */
export const DIRECTORY = 'directory'
