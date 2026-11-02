/**
 * The one mapping from a local stand's values to its gateway's settings. The mcproc manifest's
 * gateway apps (through `cli.ts`) and the root `bun run dev` (`scripts/dev/`) both define the
 * gateway's database user with `operatorSettings` and start the gateway with `gatewaySettings`,
 * so the pm2 stand and the Bun dev scripts cannot drift apart.
 */

import { wsRpcUrl } from '@workspace/data/engines/remote'
import { z } from '@workspace/zod'

const port = z.coerce
  .number({ error: 'must be a port number' })
  .int({ error: 'must be a port number' })
  .min(1, { error: 'must be a port number, 1-65535' })
  .max(65535, { error: 'must be a port number, 1-65535' })

/**
 * What a stand's gateway is set up from: the ports of the stand's SurrealDB, of the gateway
 * itself, of the stand's front (Caddy) and of the SMTP of its MailDev, all on this host, and the
 * From of every mail and the Better Auth secret of the local stands.
 */
export const standSchema = z.object({
  surreal: port,
  gateway: port,
  front: port,
  smtp: port,
  mailFrom: z.string().min(1, { error: 'must not be empty' }),
  authSecret: z.string().min(1, { error: 'must not be empty' }),
})

export type Stand = z.output<typeof standSchema>

/** The name each of a stand's values goes by somewhere else: a manifest var, a flag. */
export type StandNames = Readonly<Record<keyof Stand, string>>

/** The stands' SurrealDB root, as the manifest's SurrealDB apps start it: the operator's account. */
const STAND_ROOT = { user: 'root', pass: 'root' } as const

/** The gateway's namespace user that `scripts/stand-operator.surql` defines on a stand. */
const STAND_GATEWAY = { user: 'gateway', pass: 'gateway-stand-password' } as const

/** What the stand operator (`scripts/stand-operator.ts`) reads. */
export type OperatorSettings = Readonly<
  Record<'SURREAL_URL' | 'SURREAL_USER' | 'SURREAL_PASS', string>
>

/** The variables of the gateway's configuration (`apps/gateway/src/config.ts`) a stand sets. */
export const GATEWAY_SETTINGS = [
  'SURREAL_URL',
  'GATEWAY_PORT',
  'GATEWAY_SURREAL_USER',
  'GATEWAY_SURREAL_PASS',
  'GATEWAY_AUTH_SECRET',
  'GATEWAY_PUBLIC_URL',
  'GATEWAY_SMTP_URL',
  'GATEWAY_MAIL_FROM',
] as const

export type GatewaySettings = Readonly<Record<(typeof GATEWAY_SETTINGS)[number], string>>

/** The WebSocket endpoint of the stand's SurrealDB, which the operator and the gateway open. */
const surrealEndpoint = (stand: Stand): string => wsRpcUrl(`http://127.0.0.1:${stand.surreal}`)

/** The operator's settings: the stand's SurrealDB as its root. */
export function operatorSettings(stand: Stand): OperatorSettings {
  return {
    SURREAL_URL: surrealEndpoint(stand),
    SURREAL_USER: STAND_ROOT.user,
    SURREAL_PASS: STAND_ROOT.pass,
  }
}

/** The gateway's settings on the stand: its database user, its front, its mail server. */
export function gatewaySettings(stand: Stand): GatewaySettings {
  return {
    SURREAL_URL: surrealEndpoint(stand),
    GATEWAY_PORT: String(stand.gateway),
    GATEWAY_SURREAL_USER: STAND_GATEWAY.user,
    GATEWAY_SURREAL_PASS: STAND_GATEWAY.pass,
    GATEWAY_AUTH_SECRET: stand.authSecret,
    GATEWAY_PUBLIC_URL: `https://localhost:${stand.front}`,
    GATEWAY_SMTP_URL: `smtp://127.0.0.1:${stand.smtp}`,
    GATEWAY_MAIL_FROM: stand.mailFrom,
  }
}

const isStandKey = (key: PropertyKey | undefined, names: StandNames): key is keyof Stand =>
  typeof key === 'string' && Object.hasOwn(names, key)

/**
 * A stand read from named values (`lookUp` answers a name, `undefined` when it has none): the
 * stand, or one problem per value that is missing or wrong, each naming the value by its name.
 */
export function standFrom(
  names: StandNames,
  lookUp: (name: string) => unknown,
): { stand: Stand } | { problems: string[] } {
  const parsed = standSchema.safeParse(
    Object.fromEntries(Object.entries(names).map(([key, name]) => [key, lookUp(name)])),
  )

  if (parsed.success) {
    return { stand: parsed.data }
  }

  return {
    problems: parsed.error.issues.map((issue) => {
      const [key] = issue.path
      const name = isStandKey(key, names) ? names[key] : issue.path.join('.')

      // A missing value fails as an invalid number or string: say it is missing instead.
      return lookUp(name) === undefined ? `${name}: is missing` : `${name}: ${issue.message}`
    }),
  }
}
