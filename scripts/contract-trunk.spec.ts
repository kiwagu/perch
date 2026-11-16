import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTRACT_TRUNK = fileURLToPath(new URL('./contract-trunk.ts', import.meta.url))

/**
 * The environment of every process here: without what a git hook would pass on, the marker the
 * merge hook sets, or the machine's own git configuration and hooks.
 */
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GIT_') && name !== 'CONTRACT_AHEAD_MERGE',
    ),
  ),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

/** The checkouts the tests made, removed after each test. */
const made: string[] = []

/** Runs git in `cwd` without signing commits, and returns what it printed. */
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: ENV,
  })

  expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)

  return run.stdout.trim()
}

/** Runs git in `root` as an author, for a command that makes a commit. */
function author(root: string, ...args: string[]): string {
  return git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args)
}

/** Writes `file` in `root`, its folders included, and stages it. */
function stage(root: string, file: string, text = 'changed'): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), `${text}\n`)
  git(root, 'add', '--', file)
}

/** A checkout of its own whose first branch is `branch`, with `files` in its first commit. */
function checkout(branch: string, files: readonly string[] = ['notes.md']): string {
  const root = mkdtempSync(join(tmpdir(), 'contract-trunk-'))

  made.push(root)
  git(root, 'init', '-q', '-b', branch)

  for (const file of files) {
    stage(root, file, 'start')
  }

  author(root, 'commit', '-q', '-m', 'start')

  return root
}

/** Runs the script in `root` as the pre-commit hook does, with `env` on top. */
function run(root: string, env: Readonly<Record<string, string>> = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CONTRACT_TRUNK], {
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

describe('contract-trunk', () => {
  it('refuses a commit on contract/trunk that stages a file outside the business layer, naming it', () => {
    const root = checkout('contract/trunk')

    stage(root, 'contract/domain/platform.yaml')
    stage(root, 'apps/web/src/main.tsx')
    stage(root, 'contract/README.md')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  apps/web/src/main.tsx\n  contract/README.md\n')
    expect(result.stderr).not.toContain('platform.yaml')
  })

  it('lets a commit on contract/trunk through that stages the business layer alone', () => {
    const root = checkout('contract/trunk', ['contract/domain/screens/old.yaml'])

    stage(root, 'contract/domain/screens/me.yaml')
    stage(root, 'contract/vocabulary.md')
    stage(root, 'tests/e2e/scenarios/user/base/sign-up.md')
    git(root, 'rm', '-q', 'contract/domain/screens/old.yaml')

    const result = run(root)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('names a file moved into the business layer by the path it leaves', () => {
    const root = checkout('contract/trunk', ['apps/web/src/screens.ts'])

    mkdirSync(join(root, 'contract/domain'), { recursive: true })
    git(root, 'mv', 'apps/web/src/screens.ts', 'contract/domain/screens.ts')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  apps/web/src/screens.ts\n')
    expect(result.stderr).not.toContain('contract/domain/screens.ts')
  })

  it('holds contract/trunk to the business layer when a tag shares its name', () => {
    const root = checkout('contract/trunk')

    git(root, 'tag', 'contract/trunk')
    stage(root, 'apps/web/src/main.tsx')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  apps/web/src/main.tsx\n')
  })

  it('names a submodule outside the business layer that the configuration hides from a diff', () => {
    const root = checkout('contract/trunk')

    git(root, 'config', 'diff.ignoreSubmodules', 'all')
    git(
      root,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${git(root, 'rev-parse', 'HEAD')},vendor/lib`,
    )

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  vendor/lib\n')
  })

  it('refuses a commit when git cannot tell the branch it is on', () => {
    const root = checkout('contract/trunk')

    const result = run(root, { GIT_DIR: join(root, 'missing') })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('contract trunk: git cannot tell the branch this commit is on')
  })

  it('lets a commit on any other branch through, whatever it stages', () => {
    const root = checkout('contract/trunk-notes')

    stage(root, 'apps/web/src/main.tsx')

    const result = run(root)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('lets a commit on a detached HEAD through, whatever it stages', () => {
    const root = checkout('contract/trunk')

    git(root, 'switch', '-q', '--detach', 'HEAD')
    stage(root, 'apps/web/src/main.tsx')

    const result = run(root)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('lets a merge into contract/trunk through while it waits for its commit', () => {
    const root = landedOnMain()

    author(root, 'merge', '-q', '--no-commit', '--no-ff', 'main')

    const result = run(root)

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('lets an automatic merge into contract/trunk through, in the hook git runs before its commit', () => {
    const root = landedOnMain()

    author(
      root,
      '-c',
      `core.hooksPath=${mergeHook('CONTRACT_AHEAD_MERGE=1 ')}`,
      'merge',
      '-q',
      '--no-ff',
      '-m',
      'merge',
      'main',
    )

    expect(git(root, 'rev-list', '--count', '--merges', 'HEAD')).toBe('1')
  })

  it('takes an automatic merge for a plain commit when its hook does not say it merges', () => {
    const root = landedOnMain()
    const merge = spawnSync(
      'git',
      [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.test',
        '-c',
        `core.hooksPath=${mergeHook('')}`,
        'merge',
        '-q',
        '--no-ff',
        '-m',
        'merge',
        'main',
      ],
      { cwd: root, encoding: 'utf8', stdio: 'pipe', env: ENV },
    )

    expect(merge.status).not.toBe(0)
    expect(merge.stderr).toContain('\n  apps/web/src/main.tsx\n')
  })
})

/**
 * A contract trunk with a business commit of its own, and a `main` that got a file of the app
 * since: what a merge of main into the trunk brings in. The trunk is checked out.
 */
function landedOnMain(): string {
  const root = checkout('contract/trunk')

  git(root, 'switch', '-q', '-c', 'main')
  stage(root, 'apps/web/src/main.tsx')
  author(root, 'commit', '-q', '-m', 'landed')
  git(root, 'switch', '-q', 'contract/trunk')
  stage(root, 'contract/domain/platform.yaml')
  author(root, 'commit', '-q', '-m', 'modelled')

  return root
}

/**
 * A hooks folder whose `pre-merge-commit` runs the script with `variables` before it, as
 * `lefthook.yml` runs the pre-commit checks for an automatic merge.
 */
function mergeHook(variables: string): string {
  const hooks = mkdtempSync(join(tmpdir(), 'contract-trunk-hooks-'))

  made.push(hooks)
  writeFileSync(
    join(hooks, 'pre-merge-commit'),
    `#!/bin/sh\n${variables}exec "${process.execPath}" "${CONTRACT_TRUNK}"\n`,
    { mode: 0o755 },
  )

  return hooks
}
