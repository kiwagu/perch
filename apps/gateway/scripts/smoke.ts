#!/usr/bin/env bun
/**
 * Entry of the gateway's smoke test against a SurrealDB stand (see `smoke-run.ts`). The
 * gateway imports `.surql` files, so their loader is registered before anything else loads:
 * the repository's bunfig preload applies only to commands started from its root.
 *
 *   SURREAL_URL=ws://127.0.0.1:8010/rpc GATEWAY_SURREAL_USER=… GATEWAY_SURREAL_PASS=… bun run test:db
 */

import '@workspace/data/bun-plugin-surql'

const { runSmoke } = await import('./smoke-run')

process.exit(await runSmoke(process.env))
