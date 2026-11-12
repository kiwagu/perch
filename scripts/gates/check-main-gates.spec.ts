import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GATES } from './tree.ts'

const CHECK_MAIN_GATES = fileURLToPath(new URL('./check-main-gates.ts', import.meta.url))

/**
 * The environment of every process here: without what a git hook would pass on, or the
 * machine's own git configuration and hooks.
 */
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

/** The checkouts the tests made, removed after each test. */
const made: string[] = []

/** Runs git in `cwd` as an author who signs nothing, and returns what it printed. */
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args],
    { cwd, encoding: 'utf8', stdio: 'pipe', env: ENV },
  )

  expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)

  return run.stdout.trim()
}

/**
 * A checkout of its own whose first branch is `branch`, with one commit and a change staged on
 * top of it, as the pre-commit hook finds it.
 */
function checkout(branch: string): string {
  const root = mkdtempSync(join(tmpdir(), 'check-main-gates-'))

  made.push(root)
  git(root, 'init', '-q', '-b', branch)
  writeFileSync(join(root, 'notes.md'), 'start\n')
  git(root, 'add', 'notes.md')
  git(root, 'commit', '-q', '-m', 'start')
  writeFileSync(join(root, 'notes.md'), 'changed\n')
  git(root, 'add', 'notes.md')

  return root
}

/** Records a passing run of every suite on the tree the commit in `root` would record. */
function recordReceipts(root: string): string {
  const tree = git(root, 'write-tree')

  for (const gate of GATES) {
    mkdirSync(join(root, '.gates', gate), { recursive: true })
    writeFileSync(join(root, '.gates', gate, tree), '')
  }

  return tree
}

/** Runs the check in `root` as the pre-commit hook does, with `args`, and `env` on top. */
function run(
  root: string,
  args: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CHECK_MAIN_GATES, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...ENV, ...env },
  })
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('check-main-gates', () => {
  it('refuses a commit on main whose tree has no receipts, naming each suite to run', () => {
    const root = checkout('main')
    const tree = git(root, 'write-tree')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`gates: a commit on main needs green suites on tree ${tree}.`)
    expect(result.stderr).toContain('\n  db: run `bun run test:db` without arguments')
    expect(result.stderr).toContain('\n  e2e: run `CI=1 bun run test:e2e` without arguments')
  })

  it('allows a commit on main whose tree has the receipts of both suites', () => {
    const root = checkout('main')
    const tree = recordReceipts(root)

    const result = run(root)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(
      `gates: db and e2e suites passed on tree ${tree}, landing allowed`,
    )
  })

  it('holds a commit on main to its receipts when a tag shares the branch name', () => {
    const root = checkout('main')

    git(root, 'tag', 'main')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gates: a commit on main needs green suites on tree')
  })

  it('lets a commit on any other branch through', () => {
    const root = checkout('feat/notes')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toBe('')
  })

  it('lets a commit on a detached HEAD through', () => {
    const root = checkout('main')

    git(root, 'switch', '-q', '--detach', 'HEAD')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(result.stdout + result.stderr).toBe('')
  })

  it('holds the branch --branch names to its receipts, whatever branch HEAD is on', () => {
    const root = checkout('feat/notes')

    const result = run(root, ['--branch', 'main'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gates: a commit on main needs green suites on tree')
  })

  it('refuses a commit when git cannot tell the branch it is on', () => {
    const root = checkout('main')

    const result = run(root, [], { GIT_DIR: join(root, 'missing') })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gates: git cannot tell the branch this commit is on.')
  })
})
