import { z } from '@workspace/zod'

/** The gateway's environment, parsed once at startup. */
export const gatewayConfig = z.object({
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535),
  /**
   * The database's WebSocket endpoint, such as `ws://127.0.0.1:8000/rpc`. The gateway keeps one
   * long-lived connection to the directory, which Better Auth's adapter and the region hub share,
   * and opens it on the SDK's WebSocket engine: the adapter writes a sign-up in a transaction,
   * which the SDK runs only over WebSocket.
   */
  SURREAL_URL: z.url({
    protocol: /^wss?$/,
    error: 'must be a ws:// or wss:// address: the gateway holds one WebSocket to the directory',
  }),
  /** The gateway's namespace user on the database. */
  GATEWAY_SURREAL_USER: z.string().min(1),
  GATEWAY_SURREAL_PASS: z.string().min(1),
  /**
   * The secret Better Auth signs and encrypts with (session tokens' signatures, the private
   * keys of later plugins). Required, with no default; a new value signs no device out.
   */
  GATEWAY_AUTH_SECRET: z
    .string()
    .min(32, { error: 'must be at least 32 characters, such as openssl rand -hex 32' }),
  /**
   * The front's public origin, such as `https://localhost:5443`: the base of the links the
   * gateway writes and the one origin whose requests Better Auth trusts.
   */
  GATEWAY_PUBLIC_URL: z
    .url({ protocol: /^https?$/, error: 'must be the http(s):// origin of the front' })
    .transform((url) => url.replace(/\/+$/, '')),
  LOG_LEVEL: z.string().optional(),
})

export type GatewayConfig = z.output<typeof gatewayConfig>

/** The namespace every database of the application lives in. */
export const NAMESPACE = 'app'

/** The central database: accounts, and the server's copy of the regions. */
export const DIRECTORY = 'directory'

/**
 * The path the front (`infra/dev/Caddyfile`) serves the gateway under and strips before it passes
 * a request on: the browser reaches the gateway's `/auth/sign-in/email` at
 * `/backend/auth/sign-in/email`.
 */
export const FRONT_PREFIX = '/backend'
