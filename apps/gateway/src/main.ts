/**
 * The gateway process behind `index.ts`: reads its configuration from the environment,
 * opens the central database as the gateway's namespace user and serves devices on
 * 127.0.0.1 until it is told to stop.
 */

import { remoteEngines } from '@workspace/data/engines/remote'
import { createLogger } from '@workspace/logger'
import { systemClock } from '@workspace/replica'

import { createGatewayRoot } from './composition/root'
import { DIRECTORY, gatewayConfig, NAMESPACE } from './config'
import { SmtpMailer } from './mail'
import { startServer } from './server'

/** The gateway listens on the loopback interface only. */
const HOSTNAME = '127.0.0.1'

export async function main(env: Readonly<Record<string, string | undefined>>): Promise<void> {
  const log = createLogger('gateway')
  const parsed = gatewayConfig.safeParse(env)

  if (!parsed.success) {
    // An issue names the variable and the rule it breaks, never the value it holds.
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)

    log.fatal({ issues }, 'the gateway configuration is invalid')
    process.exit(1)
  }

  const config = parsed.data
  // The gateway sends the account mails: it does not start without a mail server that answers.
  const mail = new SmtpMailer({ url: config.GATEWAY_SMTP_URL, from: config.GATEWAY_MAIL_FROM })
  const reachable = await mail.verify()

  if (reachable.isErr()) {
    log.fatal({ code: reachable.error.code }, reachable.error.message)
    process.exit(1)
  }

  // The driver keeps trying a database it cannot reach, so the gateway waits for it here.
  log.info({ namespace: NAMESPACE, database: DIRECTORY }, 'gateway opening its database')

  const root = await createGatewayRoot({
    engines: remoteEngines(),
    url: config.SURREAL_URL,
    credentials: { username: config.GATEWAY_SURREAL_USER, password: config.GATEWAY_SURREAL_PASS },
    authSecret: config.GATEWAY_AUTH_SECRET,
    publicUrl: config.GATEWAY_PUBLIC_URL,
    mail,
    clock: systemClock,
  })

  if (root.isErr()) {
    const { code, message, cause } = root.error

    log.fatal({ code, cause: cause instanceof Error ? cause.message : undefined }, message)
    process.exit(1)
  }

  log.info({ namespace: NAMESPACE, database: DIRECTORY }, 'gateway ready')

  const server = startServer(root.value, { port: config.GATEWAY_PORT, hostname: HOSTNAME })

  log.info({ hostname: HOSTNAME, port: server.port }, 'gateway listening')

  const stop = async (signal: NodeJS.Signals): Promise<void> => {
    log.info({ signal }, 'gateway stopping')
    await server.stop()
    await root.value.close()
    process.exit(0)
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void stop(signal))
  }
}
