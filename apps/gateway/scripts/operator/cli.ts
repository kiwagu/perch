#!/usr/bin/env bun
/**
 * Entry of the operator command (usage in `main.ts`). The data layer and the gateway import
 * `.surql` files, so their loader is registered before anything else loads: the repository's
 * bunfig preload applies only to commands started from its root.
 */

import '@workspace/data/bun-plugin-surql'

// A Bun CLI entry that registers the `.surql` loader before loading the code that needs it.
const { main } = await import('./main')

process.exit(await main(process.argv.slice(2), process.env))
