import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FULL_RUN } from './full-run.ts'

const RECORD_AFTER = fileURLToPath(new URL('./record-after.ts', import.meta.url))

/** The checkouts the tests made, removed after each test. */
const made: string[] = []

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

/**
 * A checkout of its own with one commit, whose e2e launcher passes, or exits with the code in
 * `EXIT_CODE`.
 */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'record-after-'))
  const launcher = join(root, FULL_RUN.e2e[1] ?? '')

  made.push(root)
  mkdirSync(join(launcher, '..'), { recursive: true })
  writeFileSync(launcher, 'process.exit(Number(process.env.EXIT_CODE ?? 0))\n')
  git(root, 'init', '-q')
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'start')

  return root
}

/** Runs the recorder for the e2e suite in `root` with the command `command`. */
function recordAfter(
  root: string,
  command: readonly string[],
  env: Record<string, string> = {},
): SpawnSyncReturns<string> {
  return spawnSync('bun', [RECORD_AFTER, 'e2e', '--', ...command], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...env },
  })
}

/** The e2e receipts recorded in `root`. */
const receipts = (root: string): string[] => {
  const folder = join(root, '.gates', 'e2e')

  return existsSync(folder) ? readdirSync(folder) : []
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('record-after', () => {
  it('records the receipt of a full run that passed', () => {
    const root = checkout()
    const run = recordAfter(root, FULL_RUN.e2e)

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('receipt recorded')
    expect(receipts(root)).toHaveLength(1)
  })

  it('records no receipt for a run given a spec, says so, and passes as the suite did', () => {
    const root = checkout()
    const run = recordAfter(root, [...FULL_RUN.e2e, 'sync/09-key-renewal'])

    expect(run.status).toBe(0)
    expect(run.stdout).toContain(
      'gates: e2e passed on a partial run (bun tests/e2e/scripts/run-e2e.ts sync/09-key-renewal): no receipt recorded',
    )
    expect(receipts(root)).toEqual([])
  })

  it('records no receipt for a full run that failed, and fails with its code', () => {
    const root = checkout()
    const run = recordAfter(root, FULL_RUN.e2e, { EXIT_CODE: '3' })

    expect(run.status).toBe(3)
    expect(receipts(root)).toEqual([])
  })
})
