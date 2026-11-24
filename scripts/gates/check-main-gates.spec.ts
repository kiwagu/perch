import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { GATES } from './tree.ts'

const CHECK_MAIN_GATES = fileURLToPath(new URL('./check-main-gates.ts', import.meta.url))

const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The repository files the gate loads, from the top of the repository: itself and, through its
 * relative imports, every module it reaches.
 */
function gateModules(file = CHECK_MAIN_GATES, reached = new Set<string>()): Set<string> {
  reached.add(relative(REPOSITORY, file))

  for (const [, specifier = ''] of readFileSync(file, 'utf8').matchAll(/from '(\.[^']*)'/g)) {
    const module = resolve(dirname(file), specifier)

    if (!reached.has(relative(REPOSITORY, module))) {
      gateModules(module, reached)
    }
  }

  return reached
}

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

/** Writes `content` to `path` in `root`, in the working tree only. */
function write(root: string, path: string, content = 'content\n'): void {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

/** Stages a new file `path` in `root`. */
function stage(root: string, path: string, content?: string): void {
  write(root, path, content)
  git(root, 'add', path)
}

/**
 * Writes a `contract:inflight` script of its own into the working tree of `root`, in place of the
 * engine's: it runs `meanwhile` (what another checkout does while the check runs), marks each run
 * in `ran.txt`, prints `report` and exits with `status`.
 */
function writeStub(root: string, status: number, report = '', meanwhile = ''): void {
  const steps = [meanwhile, 'echo ran >> ran.txt', 'cat report.txt', `exit ${status}`]

  write(root, 'report.txt', report)
  write(
    root,
    'package.json',
    JSON.stringify({
      scripts: { 'contract:inflight': steps.filter((step) => step !== '').join('; ') },
    }),
  )
}

/** The stub staged, as the check the landing's tree holds. */
function stubInflight(root: string, status: number, report = '', meanwhile = ''): void {
  writeStub(root, status, report, meanwhile)
  git(root, 'add', 'package.json', 'report.txt')
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
    stubInflight(root, 1, REPORT)
    recordReceipts(root)

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

    stubInflight(root, 0, 'feat/clean: OK (version 1)\ninflight: 1 branch, 0 broken\n')

    const tree = recordReceipts(root)

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
    stubInflight(root, 1, REPORT)
    recordReceipts(root)

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

  it('refuses a landing whose staged check breaks branches while an unstaged one passes', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 1, REPORT)
    recordReceipts(root)
    writeStub(root, 0)

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'gates: this landing changes packages/ui-contract, and the working tree differs from the index in what the in-flight check runs, so it did not run:\n  package.json\n',
    )
    expect(inflightRan(root)).toBe(false)
    expect(result.stdout).not.toContain('landing allowed')
  })

  it('refuses a landing whose engine file is edited after it was staged', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 0)
    recordReceipts(root)
    write(root, ENGINE_FILE, 'edited\n')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`did not run:\n  ${ENGINE_FILE}\n`)
    expect(inflightRan(root)).toBe(false)
  })

  it('refuses a landing whose staged engine file is gone from the working tree', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 0)
    recordReceipts(root)
    rmSync(join(root, ENGINE_FILE))

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`did not run:\n  ${ENGINE_FILE}\n`)
    expect(inflightRan(root)).toBe(false)
  })

  it.each([
    'packages/ui-contract/src/extra.ts',
    'packages/zod/src/extra.ts',
    'packages/data/src/extra.ts',
    'bunfig.toml',
    'bun.lock',
    'scripts/gates/extra.ts',
  ])('refuses a landing with an untracked %s, a file the check may run', (path) => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 0)
    recordReceipts(root)
    write(root, path, '# untracked\n')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`did not run:\n  ${path}\n`)
    expect(inflightRan(root)).toBe(false)
  })

  it('reaches the helper modules the protection below is written for', () => {
    expect([...gateModules()]).toContain('scripts/staged-commit.ts')
  })

  it.each([...gateModules()])(
    'refuses a landing whose staged %s, a module the gate loads, is replaced after staging',
    (module) => {
      const root = checkout('main')

      stage(root, ENGINE_FILE)
      stage(root, module, '// the staged one\n')
      stubInflight(root, 0)
      recordReceipts(root)
      write(root, module, '// a replacement\n')

      const result = run(root)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`did not run:\n  ${module}\n`)
      expect(inflightRan(root)).toBe(false)
    },
  )

  it('names every differing file, in path order', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 0)
    recordReceipts(root)
    write(root, ENGINE_FILE, 'edited\n')
    write(root, 'scripts/gates/extra.ts')
    write(root, 'packages/ui-contract/src/another.ts')

    const result = run(root)

    expect(result.stderr).toContain(
      'did not run:\n  packages/ui-contract/src/another.ts\n  packages/ui-contract/src/index.ts\n  scripts/gates/extra.ts\n',
    )
  })

  it('runs the check for a landing whose working tree differs only where the check does not run', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stage(root, '.gitignore', 'coverage/\n')
    stubInflight(root, 0)
    recordReceipts(root)
    write(root, 'notes.md', 'edited after staging\n')
    write(root, 'scratch.txt')
    write(root, 'apps/web/extra.ts')
    write(root, 'packages/ui-contract/coverage/lcov.info')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(inflightRan(root)).toBe(true)
  })

  it('runs the check from the top of the checkout, whichever folder the gate starts in', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stage(root, 'apps/web/package.json', '{ "name": "web" }\n')
    stubInflight(root, 0)
    recordReceipts(root)

    const result = run(root, [], {}, join(root, 'apps/web'))

    expect(result.status).toBe(0)
    expect(inflightRan(root)).toBe(true)
  })

  it('names a differing file from the top of the checkout, whichever folder the gate starts in', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stage(root, 'apps/web/package.json', '{ "name": "web" }\n')
    stubInflight(root, 0)
    recordReceipts(root)
    write(root, 'packages/ui-contract/src/extra.ts')

    const result = run(root, [], {}, join(root, 'apps/web'))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('did not run:\n  packages/ui-contract/src/extra.ts\n')
  })

  it('refuses a landing when the check fails without naming a branch, showing what it printed', () => {
    const root = checkout('main')

    stage(root, ENGINE_FILE)
    stubInflight(root, 2, 'boom\n')
    recordReceipts(root)

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

describe('check-main-gates, branches that move while the in-flight check runs', () => {
  it('refuses a landing whose check passed while a branch moved, naming the branch', () => {
    const root = checkout('main')
    const other = git(root, 'commit-tree', '-m', 'other', git(root, 'rev-parse', 'HEAD^{tree}'))

    git(root, 'branch', 'feat/notes')
    stage(root, ENGINE_FILE)
    stubInflight(root, 0, '', `git update-ref refs/heads/feat/notes ${other}`)
    recordReceipts(root)

    const result = run(root)

    expect(result.status).toBe(1)
    expect(inflightRan(root)).toBe(true)
    expect(result.stderr).toContain(
      'gates: this landing changes packages/ui-contract, and these branches moved while the in-flight check ran, so its answer may mix their commits:\n  feat/notes\ngates: commit again',
    )
    expect(result.stdout).not.toContain('landing allowed')
  })

  it('refuses on the branches made or deleted while the check ran, not on what it reported', () => {
    const root = checkout('main')

    git(root, 'branch', 'fix/gone')
    stage(root, ENGINE_FILE)
    stubInflight(root, 1, REPORT, 'git branch feat/new; git branch -D fix/gone')
    recordReceipts(root)

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'so its answer may mix their commits:\n  feat/new\n  fix/gone\n',
    )
    expect(result.stderr).not.toContain('would break')
  })

  it('lets the landing commit through its own hook, which moves main only after the check', () => {
    const root = checkout('main')
    const hook = join(root, '.git', 'hooks', 'pre-commit')
    const start = git(root, 'rev-parse', 'main')

    git(root, 'branch', 'feat/notes')
    stage(root, ENGINE_FILE)
    stubInflight(root, 0)
    recordReceipts(root)
    write(
      root,
      '.git/hooks/pre-commit',
      `#!/bin/sh\nexec "${process.execPath}" "${CHECK_MAIN_GATES}"\n`,
    )
    chmodSync(hook, 0o755)
    git(root, 'commit', '-q', '-m', 'land')

    expect(inflightRan(root)).toBe(true)
    expect(git(root, 'rev-parse', 'main^')).toBe(start)
  })
})
