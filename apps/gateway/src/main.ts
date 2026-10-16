/**
 * The gateway process behind `index.ts`: reads its configuration from the environment
 * and opens the central database as the gateway's namespace user.
 */

import { remoteEngines } from '@workspace/data/engines/remote'
import { createLogger } from '@workspace/logger'
import { systemClock } from '@workspace/replica'

import { createGatewayRoot } from './composition/root'
import { DIRECTORY, gatewayConfig, httpRpcUrl, NAMESPACE } from './config'

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

  // The driver keeps trying a database it cannot reach, so the gateway waits for it here.
  log.info({ namespace: NAMESPACE, database: DIRECTORY }, 'gateway opening its database')

  const root = await createGatewayRoot({
    engines: remoteEngines(),
    url: config.SURREAL_URL,
    credentials: { username: config.GATEWAY_SURREAL_USER, password: config.GATEWAY_SURREAL_PASS },
    rpcUrl: httpRpcUrl(config.SURREAL_URL),
    clock: systemClock,
  })

  if (root.isErr()) {
    const { code, message, cause } = root.error

    log.fatal({ code, cause: cause instanceof Error ? cause.message : undefined }, message)
    process.exit(1)
  }

  log.info({ namespace: NAMESPACE, database: DIRECTORY }, 'gateway ready')
}
