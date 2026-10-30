/**
 * The full run of each suite: the one command a receipt stands for. A run given anything beyond
 * it (a spec, a filter, a project, even a reporter) ran a part of the suite, or ran it otherwise,
 * so it passes or fails as usual but earns no receipt.
 */

import type { Gate } from './tree.ts'

/** The command each suite's root script wraps, as `record-after.ts` is handed it. */
export const FULL_RUN: Readonly<Record<Gate, readonly string[]>> = {
  db: ['turbo', 'run', 'test:db'],
  e2e: ['bun', 'tests/e2e/scripts/run-e2e.ts'],
}

/** How a person runs each suite in full, so that it records its receipt. */
export const FULL_RUN_SCRIPT: Readonly<Record<Gate, string>> = {
  db: 'bun run test:db',
  e2e: 'CI=1 bun run test:e2e',
}

/** Whether `command` is exactly the full run of `gate`, with nothing after it. */
export function isFullRun(gate: Gate, command: readonly string[]): boolean {
  const full = FULL_RUN[gate]

  return command.length === full.length && full.every((part, at) => command[at] === part)
}
