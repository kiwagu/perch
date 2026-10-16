/**
 * Runs `turbo run build` on all CPU cores but a reserved few, so a full build
 * leaves the machine responsive. On Linux the whole process tree is pinned to
 * the allowed cores with `taskset`; elsewhere only turbo's concurrency is capped.
 *
 * Usage:
 *   bun run build                          # reserves 2 cores
 *   BUILD_RESERVED_CORES=0 bun run build   # every core, e.g. on CI
 *   bun run build -- --filter=@workspace/web
 */

import { spawnSync } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { delimiter, join } from 'node:path'

function reservedCores(): number {
  const value = Number.parseInt(process.env['BUILD_RESERVED_CORES'] ?? '', 10)

  return Number.isFinite(value) && value >= 0 ? value : 2
}

const total = Math.max(1, availableParallelism())
const cores = Math.max(1, total - reservedCores())
const turboArgs = ['run', 'build', `--concurrency=${cores}`, ...process.argv.slice(2)]
const pin = process.platform === 'linux' && cores < total
const command = pin ? 'taskset' : 'turbo'
const args = pin ? ['-c', `0-${cores - 1}`, 'turbo', ...turboArgs] : turboArgs
const path = `${join(process.cwd(), 'node_modules', '.bin')}${delimiter}${process.env['PATH'] ?? ''}`

console.log(`[build-capped] building on ${cores} of ${total} cores${pin ? ' (pinned)' : ''}`)

const result = spawnSync(command, args, { stdio: 'inherit', env: { ...process.env, PATH: path } })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
