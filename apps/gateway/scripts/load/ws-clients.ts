#!/usr/bin/env bun
/**
 * Entry of the gateway load test (see `load-run/`). It needs a SurrealDB stand: through the
 * root's `bun run load` the stand's `SURREAL_URL` comes from `mcproc exec`. The gateway
 * imports `.surql` files, so their loader is registered before anything else loads: the
 * repository's bunfig preload applies only to commands started from its root.
 *
 *   bun run load -- [--devices 100,500] [--members 20] [--writers 0.3] [--rate 0.1] [--hold 60]
 *     [--gateway-port 5197] [--surreal-container name] [--json report.json] [--stop-on-degrade]
 */

import '@workspace/data/bun-plugin-surql'

const { runLoadTest } = await import('./load-run')

process.exit(await runLoadTest(process.argv.slice(2), process.env))
