/** The gateway a load run drives, started as a child process of the run. */

import { resolve } from 'node:path'

import { wsRpcUrl } from '@workspace/data/engines/remote'

import type { LoadArgs } from '../metrics'

import { sleep } from './pacing'
import { fail } from './state'

const REPO_ROOT = resolve(import.meta.dir, '../../../../..')
const HEALTH_TIMEOUT_MS = 30_000
/** The gap between health checks: the restart step reads the first 200 off it. */
const HEALTH_POLL_MS = 50
const STOP_GRACE_MS = 5_000

/** Whether something answers `/health` of `args.gatewayPort` with 200. */
async function healthy(args: LoadArgs): Promise<boolean> {
  return fetch(`http://127.0.0.1:${args.gatewayPort}/health`, {
    signal: AbortSignal.timeout(2000),
  }).then(
    (response) => response.status === 200,
    () => false,
  )
}

/** Starts the gateway as a child process and waits for its health to answer 200. */
export async function startGateway(
  args: LoadArgs,
  onSpawn: (child: Bun.Subprocess) => void,
): Promise<Bun.Subprocess<'ignore', 'ignore', 'inherit'>> {
  if (await healthy(args)) {
    fail(`port ${args.gatewayPort} already answers /health: a stale gateway? stop it first`)
  }

  const gateway = Bun.spawn(['bun', 'apps/gateway/src/index.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      GATEWAY_PORT: String(args.gatewayPort),
      SURREAL_URL: wsRpcUrl(args.surrealUrl),
      GATEWAY_SURREAL_USER: args.gatewayUser,
      GATEWAY_SURREAL_PASS: args.gatewayPass,
      LOG_LEVEL: 'warn',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  })

  onSpawn(gateway)

  const deadline = Date.now() + HEALTH_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (gateway.exitCode !== null) fail(`the gateway exited with ${gateway.exitCode}`)

    if (await healthy(args)) return gateway

    await sleep(HEALTH_POLL_MS)
  }

  gateway.kill('SIGTERM')

  return fail(`the gateway did not answer /health within ${HEALTH_TIMEOUT_MS / 1000} s`)
}

/** Stops the gateway child: SIGTERM, then SIGKILL after 5 s. */
export async function stopGateway(gateway: Bun.Subprocess): Promise<void> {
  gateway.kill('SIGTERM')

  const killer = setTimeout(() => gateway.kill('SIGKILL'), STOP_GRACE_MS)

  await gateway.exited
  clearTimeout(killer)
}
