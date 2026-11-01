import { z } from '@workspace/zod'

/**
 * Whether the host of an smtp:// or smtps:// address names a mail server by a domain name or an
 * IP address. The URL standard keeps the host of such an address opaque, so a NUL byte written
 * `%00` or an escaped slash passes it, while the mail library reads the host the way a web
 * address's host is read and refuses one that does not parse so, with an error that carries the
 * whole address, the password with it. An address that does not parse at all is left to the
 * address check.
 */
function namesMailServer(url: string): boolean {
  if (!URL.canParse(url)) {
    return true
  }

  const { host, hostname } = new URL(url)

  return hostname === '' || URL.canParse(`http://${host}`)
}

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
  /**
   * The SMTP server the gateway sends the account mails through, such as `smtp://127.0.0.1:1025`
   * (a stand's MailDev) or `smtps://user:password@smtp.example.test:465`. Required: the account
   * mails go out through it, and the gateway checks the server at start. It carries no query
   * string or fragment: the mail library reads a query parameter as an option of its transport,
   * over the gateway's own waits and its silence (`?logger=true` would log every address).
   */
  GATEWAY_SMTP_URL: z
    .url({
      protocol: /^smtps?$/,
      error: 'must be the smtp:// or smtps:// address of the mail server',
    })
    .refine((url) => !/[?#]/.test(url), {
      error: 'must carry no query string or fragment: the mail library reads them as its options',
    })
    .refine(namesMailServer, {
      error: 'must name the mail server by a domain name or an IP address',
    }),
  /** The From of every mail the gateway sends, such as `Perch <no-reply@example.test>`. */
  GATEWAY_MAIL_FROM: z.string().regex(/^([^<>]+ <[^<>@\s]+@[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+)$/, {
    error: 'must be an address, such as Perch <no-reply@example.test>',
  }),
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
