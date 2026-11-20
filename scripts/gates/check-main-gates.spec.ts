import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

/** A file of the engine, which a landing's round may stage. */
const ENGINE_FILE = 'packages/ui-contract/src/index.ts'

/** What `bun run contract:inflight` prints when two of three branches in flight break. */
const REPORT = [
  'feat/notes: 2 problems',
  '  contract/domain/a.yaml:3: a message',
  '  contract/domain/b.yaml:7: another message',
  'feat/clean: OK (version 1)',
  'fix/gone: 1 problem',
  '  the contract at fix/gone does not load: a message',
  'inflight: 3 branches, 2 broken',
  '',
].join('\n')

/** Stages a new file `path` in `root`. */
function stage(root: string, path: string, content = 'content\n'): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
  git(root, 'add', path)
}

/**
 * Gives `root` a `contract:inflight` script of its own, in place of the engine's: it marks each
 * run in `ran.txt`, prints `report` and exits with `status`. Untracked, so the index keeps its tree.
 */
function stubInflight(root: string, status: number, report = ''): void {
  writeFileSync(join(root, 'report.txt'), report)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      scripts: { 'contract:inflight': `echo ran >> ran.txt; cat report.txt; exit ${status}` },
    }),
  )
}

/** Whether the stub of `root` ran. */
function inflightRan(root: string): boolean {
  return existsSync(join(root, 'ran.txt'))
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

/**
 * Runs the check in `root` as the pre-commit hook does, with `args`, and `env` on top; from
 * `cwd`, the top of `root` by default.
 */
function run(
  root: string,
  args: readonly string[] = [],
  env: Readonly<Record<string, string>> = {},
  cwd: string = root,
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CHECK_MAIN_GATES, ...args], {
    cwd,
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

describe('check-main-gates, the branches in flight', () => {
  it('refuses a landing that changes the engine when a branch in flight would break, naming each', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    recordReceipts(root)
    stubInflight(root, 1, REPORT)

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'gates: this landing changes packages/ui-contract, and these branches in flight would break:\n  feat/notes\n  fix/gone\n',
    )
    expect(result.stderr).toContain('`bun run contract:inflight`')
    expect(result.stderr).not.toContain('feat/clean')
    expect(result.stdout).not.toContain('landing allowed')
  })

  it('allows a landing that changes the engine when no branch in flight would break', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)

    const tree = recordReceipts(root)

    stubInflight(root, 0, 'feat/clean: OK (version 1)\ninflight: 1 branch, 0 broken\n')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(inflightRan(root)).toBe(true)
    expect(result.stdout).toContain(
      `gates: db and e2e suites passed on tree ${tree} and no branch in flight breaks, landing allowed`,
    )
  })

  it('does not run the check for a landing that leaves the engine alone', () => {
    const root = checkout('main')

    stage(root, 'packages/ui-contract-extras/notes.md')
    recordReceipts(root)
    stubInflight(root, 1, REPORT)

    const result = run(root)

    expect(result.status).toBe(0)
    expect(inflightRan(root)).toBe(false)
  })

  it('does not run the check for a commit on another branch', () => {
    const root = checkout('feat/notes')

    stage(root, ENGINE_FILE)
    stubInflight(root, 1, REPORT)

    const result = run(root)

    expect(result.status).toBe(0)
    expect(inflightRan(root)).toBe(false)
  })

  it('refuses a landing when git cannot list the files it stages', () => {
    const root = checkout('main')

    stubInflight(root, 0)

    const result = run(root, ['--branch', 'main'], { GIT_DIR: join(root, 'missing') })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gates: git cannot list the files this commit stages.')
    expect(inflightRan(root)).toBe(false)
  })

  it('runs the check from the top of the checkout, whichever folder the gate starts in', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stage(root, 'apps/web/package.json', '{ "name": "web" }\n')
    recordReceipts(root)
    stubInflight(root, 0)

    const result = run(root, [], {}, join(root, 'apps/web'))

    expect(result.status).toBe(0)
    expect(inflightRan(root)).toBe(true)
  })

  it('refuses a landing when the check fails without naming a branch, showing what it printed', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    recordReceipts(root)
    stubInflight(root, 2, 'boom\n')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'gates: this landing changes packages/ui-contract, and the in-flight check failed (exit 2) without naming a branch:\n  boom\n',
    )
    expect(result.stderr).toContain('`bun run contract:inflight`')
  })

  it('names the missing receipts and the broken branches together', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 1, REPORT)

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('gates: a commit on main needs green suites on tree')
    expect(result.stderr).toContain('these branches in flight would break:\n  feat/notes')
  })
})
