import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CONTRACT_AHEAD = fileURLToPath(new URL('./contract-ahead.ts', import.meta.url))

/** What the hook's command sees: the ahead mode and the base, `null` where unset. */
const PRINT_MODE =
  'console.log(JSON.stringify([process.env.CONTRACT_AHEAD ?? null, process.env.CONTRACT_AHEAD_BASE ?? null]))'

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

/** Commits a change of `notes.md` in `root`. */
function commit(root: string, text: string): void {
  writeFileSync(join(root, 'notes.md'), `${text}\n`)
  git(root, 'add', '-A')
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', text)
}

/** A checkout of its own whose first branch is `branch`, with one commit on it. */
function checkout(branch: string): string {
  const root = mkdtempSync(join(tmpdir(), 'contract-ahead-'))

  made.push(root)
  git(root, 'init', '-q', '-b', branch)
  commit(root, 'start')

  return root
}

/** Runs the command of the hook through the script in `root`, a stale ahead mode around it. */
function run(root: string, code = PRINT_MODE): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CONTRACT_AHEAD, process.execPath, '-e', code], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...ENV, CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: 'stale' },
  })
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
    expect(JSON.parse(result.stdout)).toEqual([null, null])
  })

  it('runs the command on a detached HEAD in the strict mode, as on main', () => {
    const root = checkout('main')

    git(root, 'switch', '-q', '-c', 'feature')
    commit(root, 'feature')
    git(root, 'switch', '-q', '--detach', 'HEAD')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([null, null])
  })

  it('runs the command on a branch in the ahead mode, at its merge base with main', () => {
    const root = checkout('main')
    const base = git(root, 'rev-parse', 'HEAD')

    git(root, 'switch', '-q', '-c', 'feature')
    commit(root, 'feature')

    const result = run(root)

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(['1', base])
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
