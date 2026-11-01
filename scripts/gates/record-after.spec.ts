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

/** Runs git in `cwd` without signing commits, and expects it to succeed. */
function git(cwd: string, ...args: string[]): void {
  const run = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)
}

/**
 * A checkout of its own with one commit, whose e2e launcher passes, or exits with the code in
 * `EXIT_CODE`. While it runs it edits the tracked file `notes.md` when `EDIT_DURING_RUN` is set,
 * and edits it and puts the committed bytes back when `EDIT_AND_REVERT` is.
 */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'record-after-'))
  const launcher = join(root, FULL_RUN.e2e[1] ?? '')

  made.push(root)
  mkdirSync(join(launcher, '..'), { recursive: true })
  writeFileSync(
    launcher,
    [
      "import { appendFileSync, writeFileSync } from 'node:fs'",
      "if (process.env.EDIT_DURING_RUN) appendFileSync('notes.md', 'edited during the run\\n')",
      'if (process.env.EDIT_AND_REVERT) {',
      "  writeFileSync('notes.md', 'what the suite read\\n')",
      "  writeFileSync('notes.md', 'as committed\\n')",
      '}',
      'process.exit(Number(process.env.EXIT_CODE ?? 0))',
      '',
    ].join('\n'),
  )
  writeFileSync(join(root, 'notes.md'), 'as committed\n')
  writeFileSync(join(root, '.gitignore'), '.gates/\n')
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
    const run = recordAfter(root, [...FULL_RUN.e2e, 'user/flows/sign-out'])

    expect(run.status).toBe(0)
    expect(run.stdout).toContain(
      'gates: e2e passed on a partial run (bun tests/e2e/scripts/run-e2e.ts user/flows/sign-out): no receipt recorded',
    )
    expect(receipts(root)).toEqual([])
  })

  it('records no receipt when the tree changed during the run, and fails', () => {
    const root = checkout()
    const run = recordAfter(root, FULL_RUN.e2e, { EDIT_DURING_RUN: '1' })

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('gates: files changed during the e2e run: notes.md')
    expect(receipts(root)).toEqual([])
  })

  it('records no receipt when a file was edited and put back during the run, and fails', () => {
    const root = checkout()
    const run = recordAfter(root, FULL_RUN.e2e, { EDIT_AND_REVERT: '1' })

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('gates: files changed during the e2e run: notes.md')
    expect(receipts(root)).toEqual([])
  })

  it('records no receipt for a full run that failed, and fails with its code', () => {
    const root = checkout()
    const run = recordAfter(root, FULL_RUN.e2e, { EXIT_CODE: '3' })

    expect(run.status).toBe(3)
    expect(receipts(root)).toEqual([])
  })
})
