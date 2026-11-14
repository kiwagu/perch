import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTRACT_AHEAD = fileURLToPath(new URL('./contract-ahead.ts', import.meta.url))

/** A whole contract the engine reads, its files where a repository keeps them. */
const CONTRACT = fileURLToPath(
  new URL('../packages/ui-contract/src/__fixtures__/repository', import.meta.url),
)

/** What the hook's command sees: the ahead mode, the base and the branch's HEAD, `null` where unset. */
const PRINT_MODE =
  'console.log(JSON.stringify([process.env.CONTRACT_AHEAD ?? null, process.env.CONTRACT_AHEAD_BASE ?? null, process.env.CONTRACT_AHEAD_HEAD ?? null]))'

const NO_MERGE_BASE =
  'unit tests: no merge base of HEAD and the local branch main (main is missing, or this branch shares no history with it), so the machines cannot be compared with their flows at the branch base. Fetch main (git fetch origin main:main) or merge it into this branch, then commit again.'

/** The environment of every process here, without what a git hook would pass on. */
const ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
)

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

/** Commits a change of `file` in `root`. */
function commit(root: string, text: string, file = 'notes.md'): void {
  writeFileSync(join(root, file), `${text}\n`)
  git(root, 'add', '-A')
  author(root, 'commit', '-q', '-m', text)
}

/** A checkout of its own whose first branch is `branch`, with one commit on it: a contract. */
function checkout(branch: string): string {
  const root = mkdtempSync(join(tmpdir(), 'contract-ahead-'))

  made.push(root)
  git(root, 'init', '-q', '-b', branch)
  cpSync(CONTRACT, root, { recursive: true })
  commit(root, 'start')

  return root
}

/** Commits a contract the engine cannot read on the branch `root` is on: its platform breaks. */
function breakContract(root: string): void {
  commit(root, 'version: [', 'contract/domain/platform.yaml')
}

/**
 * A branch `feature` of its own commit, and a `main` that moved on in another file since: the
 * landing a merge of main brings in, whose commit is returned.
 */
function landedSince(root: string): string {
  git(root, 'switch', '-q', '-c', 'feature')
  commit(root, 'feature')
  git(root, 'switch', '-q', 'main')
  commit(root, 'landed', 'landed.md')

  const landed = git(root, 'rev-parse', 'HEAD')

  git(root, 'switch', '-q', 'feature')

  return landed
}

/**
 * Runs the command of the hook through the script in `root`, a stale ahead mode around it and
 * `env` on top.
 */
function run(
  root: string,
  code = PRINT_MODE,
  env: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CONTRACT_AHEAD, process.execPath, '-e', code], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...ENV,
      CONTRACT_AHEAD: '1',
      CONTRACT_AHEAD_BASE: 'stale',
      CONTRACT_AHEAD_HEAD: 'stale',
      ...env,
    },
  })
}

/**
 * A hooks folder whose `pre-merge-commit` runs the script as `lefthook.yml` does, telling it
 * that it runs for an automatic merge, and writes what the command saw into `mode`.
 */
function mergeHook(): { readonly hooks: string; readonly mode: string } {
  const hooks = mkdtempSync(join(tmpdir(), 'contract-ahead-hooks-'))
  const mode = join(hooks, 'mode.json')

  made.push(hooks)
  writeFileSync(
    join(hooks, 'pre-merge-commit'),
    `#!/bin/sh\nCONTRACT_AHEAD_MERGE=1 exec "${process.execPath}" "${CONTRACT_AHEAD}" "${process.execPath}" -e '${PRINT_MODE}' > "${mode}"\n`,
    { mode: 0o755 },
  )

  return { hooks, mode }
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('contract-ahead', () => {
  it('runs the command on main in the strict mode, whatever the environment held', () => {
    const result = run(checkout('main'))

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([null, null, null])
  })

  it('runs the command on a detached HEAD in the strict mode, as on main', () => {
    const root = checkout('main')

    git(root, 'switch', '-q', '-c', 'feature')
    commit(root, 'feature')
    git(root, 'switch', '-q', '--detach', 'HEAD')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([null, null, null])
  })

  it('runs the command on a branch in the ahead mode, at its merge base with main and its HEAD', () => {
    const root = checkout('main')
    const base = git(root, 'rev-parse', 'HEAD')

    git(root, 'switch', '-q', '-c', 'feature')
    commit(root, 'feature')

    const head = git(root, 'rev-parse', 'HEAD')
    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['1', base, head])
  })

  it('runs a merge of main waiting for its commit at the base the merge will have', () => {
    const root = checkout('main')
    const landed = landedSince(root)
    const head = git(root, 'rev-parse', 'HEAD')

    git(root, 'merge', '-q', '--no-commit', 'main')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['1', landed, head])
  })

  it('runs an automatic merge of main at the base the merge will have, in its hook', () => {
    const root = checkout('main')
    const landed = landedSince(root)
    const head = git(root, 'rev-parse', 'HEAD')
    const { hooks, mode } = mergeHook()

    author(root, '-c', `core.hooksPath=${hooks}`, 'merge', '-q', '-m', 'merge main', 'main')

    expect(JSON.parse(readFileSync(mode, 'utf8'))).toEqual(['1', landed, head])
  })

  it('runs a merge of main without the HEAD whose contract the engine here cannot read', () => {
    const root = checkout('main')
    const landed = landedSince(root)

    breakContract(root)
    git(root, 'merge', '-q', '--no-commit', 'main')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['1', landed, null])
  })

  it('runs an automatic merge of main without that HEAD, in its hook', () => {
    const root = checkout('main')
    const landed = landedSince(root)
    const { hooks, mode } = mergeHook()

    breakContract(root)
    author(root, '-c', `core.hooksPath=${hooks}`, 'merge', '-q', '-m', 'merge main', 'main')

    expect(JSON.parse(readFileSync(mode, 'utf8'))).toEqual(['1', landed, null])
  })

  it('keeps the HEAD of a commit outside a merge, whose contract the tests then report', () => {
    const root = checkout('main')
    const base = git(root, 'rev-parse', 'HEAD')

    git(root, 'switch', '-q', '-c', 'feature')
    breakContract(root)

    const head = git(root, 'rev-parse', 'HEAD')
    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['1', base, head])
  })

  it('runs an automatic pull of main at the base the merge will have, in its hook', () => {
    const origin = checkout('main')
    const root = mkdtempSync(join(tmpdir(), 'contract-ahead-clone-'))

    made.push(root)
    git(root, 'clone', '-q', origin, '.')
    git(root, 'switch', '-q', '-c', 'feature')
    commit(root, 'feature')
    commit(origin, 'landed', 'landed.md')

    const head = git(root, 'rev-parse', 'HEAD')
    const landed = git(origin, 'rev-parse', 'HEAD')
    const { hooks, mode } = mergeHook()

    git(root, 'fetch', '-q', 'origin', 'main:main')
    author(
      root,
      '-c',
      `core.hooksPath=${hooks}`,
      'pull',
      '-q',
      '--no-rebase',
      '--no-edit',
      'origin',
      'main',
    )

    expect(JSON.parse(readFileSync(mode, 'utf8'))).toEqual(['1', landed, head])
  })

  it('runs an ordinary commit at its merge base, whatever merge its environment names', () => {
    const root = checkout('main')
    const base = git(root, 'rev-parse', 'HEAD')

    landedSince(root)

    const head = git(root, 'rev-parse', 'HEAD')
    const result = run(root, PRINT_MODE, { GIT_REFLOG_ACTION: 'merge main' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['1', base, head])
  })

  it('stops an automatic merge whose heads it cannot tell, and runs nothing', () => {
    const root = checkout('main')

    landedSince(root)

    const result = run(root, PRINT_MODE, {
      CONTRACT_AHEAD_MERGE: '1',
      GIT_REFLOG_ACTION: 'merge no-such-branch',
    })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(
      'unit tests: cannot tell the commits this automatic merge brings in from its reflog action (merge no-such-branch), so the machines cannot be compared with their flows at the base the merge will have. Merge with --no-commit, then commit.',
    )
  })

  it('passes the exit status of the command on', () => {
    expect(run(checkout('main'), 'process.exit(3)').status).toBe(3)
  })

  it('stops on a branch when there is no local main, and runs nothing', () => {
    const result = run(checkout('feature'))

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(NO_MERGE_BASE)
  })

  it('stops on a branch that shares no history with main, and runs nothing', () => {
    const root = checkout('main')

    git(root, 'switch', '-q', '--orphan', 'feature')
    commit(root, 'unrelated')

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr.trim()).toBe(NO_MERGE_BASE)
  })
})
