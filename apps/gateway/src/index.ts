#!/usr/bin/env bun
/**
 * Entry of the gateway process (see `main.ts`). The data and replica packages import
 * `.surql` files, so their loader is registered before anything else loads: the
 * repository's bunfig preload applies only to commands started from its root.
 */

import '@workspace/data/bun-plugin-surql'

const { main } = await import('./main')

await main(process.env)
