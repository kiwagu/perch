#!/usr/bin/env bun
/**
 * Entry of the `seed` command (usage in `main.ts`). The application and the data
 * layer import `.surql` files, so their loader is registered before anything else
 * loads: the repository's bunfig preload applies only to commands started from its
 * root.
 */

import '@workspace/data/bun-plugin-surql'

const { main } = await import('./main')

process.exit(await main(process.argv.slice(2)))
