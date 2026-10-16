#!/usr/bin/env bun
/**
 * The modeling CLI.
 *
 *   model --root <dir> [--schema <dir>] [--suites <dir>] [--check]
 *
 * The data layer imports `.surql` files, so their loader is registered before the
 * stage loads: the repository's bunfig preload applies only to commands started
 * from its root.
 */

import '@workspace/data/bun-plugin-surql'

const { main } = await import('./run-model')

process.exit(await main(process.argv.slice(2)))
