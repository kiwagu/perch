import { afterEach, describe, expect, it } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOKS_INSTALLED = fileURLToPath(new URL('./hooks-installed.ts', import.meta.url))

/** The repository's own binaries, lefthook among them, as `scripts/ensure-path.sh` adds them. */
const BIN = fileURLToPath(new URL('../node_modules/.bin', import.meta.url))

/**
 * The environment of every process here: without what a git hook would pass on, lefthook's own
 * switches, or the machine's own git configuration.
 */
const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GIT_') && !name.startsWith('LEFTHOOK'),
    ),
  ),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  PATH: `${BIN}:${process.env['PATH'] ?? ''}`,
}

const CONFIG = [
  'pre-commit:',
  '  jobs:',
  '    - name: checks',
  '      run: "true"',
  'commit-msg:',
  '  jobs:',
  '    - name: message',
  '      run: "true"',
  '',
].join('\n')

/** The checkouts the tests made, removed after each test. */
const made: string[] = []

/** Runs git in `cwd` and returns what it printed. */
function git(cwd: string, ...args: string[]): string {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', env: ENV })

  expect(run.status, `git ${args.join(' ')}: ${run.stderr}`).toBe(0)

  return run.stdout.trim()
}

/** A checkout configured by `config`, with the hooks `installed` written as executable files. */
function checkout(config: string, installed: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'hooks-installed-'))

  made.push(root)
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, 'lefthook.yml'), config)

  for (const hook of installed) {
    install(root, hook)
  }

  return root
}

/** Writes the hook `name` where git runs it from, executable unless `mode` says otherwise. */
function install(root: string, name: string, mode = 0o755): void {
  const hooks = git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks')

  mkdirSync(hooks, { recursive: true })
  writeFileSync(join(hooks, name), '#!/bin/sh\nexit 0\n', { mode })
}

/** Runs the script in `root` as the pre-commit hook does. */
function run(root: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [HOOKS_INSTALLED], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: ENV,
  })
}

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('hooks-installed', () => {
  it('lets a commit through when every hook the configuration names is installed', () => {
    const result = run(checkout(CONFIG, ['pre-commit', 'commit-msg']))

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('refuses a commit while a hook the configuration names is not installed, saying how to install it', () => {
    const result = run(checkout(CONFIG, ['pre-commit']))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  commit-msg\n')
    expect(result.stderr).not.toContain('\n  pre-commit\n')
    expect(result.stderr).toContain('bunx lefthook install')
  })

  it('counts a hook file git cannot run as not installed', () => {
    const root = checkout(CONFIG, ['pre-commit'])

    install(root, 'commit-msg', 0o644)

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  commit-msg\n')
  })

  it('holds the hooks a machine-local configuration adds too', () => {
    const root = checkout(CONFIG, ['pre-commit', 'commit-msg'])

    writeFileSync(
      join(root, 'lefthook-local.yml'),
      'pre-push:\n  jobs:\n    - name: local\n      run: "true"\n',
    )

    const result = run(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('\n  pre-push\n')
  })

  it('refuses a commit when the configuration cannot be read', () => {
    const result = run(checkout('pre-commit: [\n', ['pre-commit']))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('git hooks: lefthook cannot read its configuration')
  })
})
