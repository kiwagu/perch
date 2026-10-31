#!/usr/bin/env bun
/**
 * Entry of the gateway's smoke test against a SurrealDB stand (see `run.ts`). The
 * gateway imports `.surql` files, so their loader is registered before anything else loads:
 * the repository's bunfig preload applies only to commands started from its root.
 *
 *   GATEWAY_AUTH_SECRET=… GATEWAY_PUBLIC_URL=… [SURREAL_URL=http://127.0.0.1:8010]
 *     [GATEWAY_SURREAL_USER=…] [GATEWAY_SURREAL_PASS=…] bun run test:db
 *
 * `GATEWAY_AUTH_SECRET` (Better Auth's secret) and `GATEWAY_PUBLIC_URL` (the front's origin) are
 * those the stand's gateway runs with; `bun run test:db` at the repository root sets them and
 * `SURREAL_URL` through `mcproc exec`.
 */

import '@workspace/data/bun-plugin-surql'

const { runSmoke } = await import('./run')

process.exit(await runSmoke(process.env))
