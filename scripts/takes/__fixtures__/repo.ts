/**
 * Hermetic git checkouts for the take check's specs: a trunk with its area branch, commits made
 * on them unchecked or through the script installed as the commit-msg hook, and what a passing or
 * a refusing run of the check answers. Every checkout made here is removed by `removeMade`, which
 * each spec runs after each test.
 */

import { expect } from 'bun:test'
import { type SpawnSyncReturns, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONTRACT_TAKE = fileURLToPath(new URL('../../contract-take.ts', import.meta.url))

/**
 * The environment of every process here: without what a git hook would pass on, the marker the
 * merge hook sets, or the machine's own git configuration and hooks.
 */
export const ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('GIT_') && name !== 'CONTRACT_AHEAD_MERGE',
    ),
  ),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
}

export const SCREEN = 'contract/domain/screens/me.yaml'
export const SCENARIO = 'tests/e2e/scenarios/user/base/me.md'
export const VOCABULARY = 'contract/vocabulary.md'

/** The checkouts the tests made, removed after each test. */
export const made: string[] = []

/** Runs git in `cwd` without signing commits, and returns what it printed. */
export function git(cwd: string, ...args: string[]): string {
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
export function author(root: string, ...args: string[]): string {
  return git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args)
}

/** Writes `file` in `root`, its folders included, and stages it. */
export function stage(root: string, file: string, text = 'changed'): void {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), `${text}\n`)
  git(root, 'add', '--', file)
}

/** Commits what `root` stages as `subject`, unchecked, and returns the commit's short id. */
export function commit(root: string, subject: string): string {
  author(root, 'commit', '-q', '-m', subject)

  return git(root, 'rev-parse', '--short', 'HEAD')
}

/** The commits of a contract trunk: three business commits of its own, oldest first. */
export interface Trunk {
  readonly root: string
  readonly screen: string
  readonly scenario: string
  readonly vocabulary: string
}

/**
 * A checkout whose `main` holds the business layer's files, whose `contract/trunk` changes each
 * of them in a commit of its own, and whose area branch `feat/me`, cut from `main`, is checked out.
 */
export function trunk(): Trunk {
  const root = mkdtempSync(join(tmpdir(), 'contract-take-'))

  made.push(root)
  git(root, 'init', '-q', '-b', 'main')

  for (const file of [SCREEN, SCENARIO, VOCABULARY, 'apps/web/src/main.tsx']) {
    stage(root, file, 'start')
  }

  commit(root, 'start')
  git(root, 'switch', '-q', '-c', 'contract/trunk')
  stage(root, SCREEN, 'modelled')

  const screen = commit(root, 'feat(screens): model the page')

  stage(root, SCENARIO, 'walked')

  const scenario = commit(root, 'test(scenarios): walk the page')

  stage(root, VOCABULARY, 'worded')

  const vocabulary = commit(root, 'feat(screens): name its codes')

  git(root, 'switch', '-q', '-c', 'feat/me', 'main')

  return { root, screen, scenario, vocabulary }
}

/** Runs the script in `root` as the commit-msg hook does, on `message`, with `env` on top. */
export function run(
  root: string,
  message: string,
  env: Readonly<Record<string, string>> = {},
): SpawnSyncReturns<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'contract-take-message-')), 'COMMIT_EDITMSG')

  made.push(dirname(file))
  writeFileSync(file, message)

  return spawnSync(process.execPath, [CONTRACT_TAKE, file], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...ENV, ...env },
  })
}

/** Runs the script in `root` on a branch's round, `--round` with `args`, as a gate would. */
export function runRound(root: string, ...args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CONTRACT_TAKE, '--round', ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: ENV,
  })
}

/**
 * Lands `branch` on `main` as a squash committed unchecked with `subject` and the trailer naming
 * the branch's tip, returns the squash's short id, and leaves the branch that was checked out
 * checked out again.
 */
export function land(root: string, branch: string, subject = 'feat(web): land the page'): string {
  const from = git(root, 'branch', '--show-current')
  const tip = git(root, 'rev-parse', '--short', branch)

  git(root, 'switch', '-q', 'main')
  author(root, 'merge', '-q', '--squash', branch)
  author(root, 'commit', '-q', '-m', subject, '-m', `Squashed-from: ${branch} (${tip}) ABC-1`)

  const squash = git(root, 'rev-parse', '--short', 'HEAD')

  git(root, 'switch', '-q', from)

  return squash
}

/** Installs the script as `root`'s commit-msg hook, run as git runs a hook. */
export function installHook(root: string): void {
  writeFileSync(
    join(root, '.git', 'hooks', 'commit-msg'),
    `#!/bin/sh\nexec "${process.execPath}" "${CONTRACT_TAKE}" "$1"\n`,
    { mode: 0o755 },
  )
}

/**
 * Runs git in `root` with `args` (its command first) through the script installed as the
 * commit-msg hook, as git runs it, so that it reads the command the commit is made by; an editor,
 * where one opens, writes `edited` in place of the message git offers, above git's comments.
 */
export function gitThroughHook(
  root: string,
  edited: string,
  ...args: string[]
): SpawnSyncReturns<string> {
  const editor = join(root, '.git', 'editor.sh')

  installHook(root)
  writeFileSync(
    editor,
    '#!/bin/sh\n{ cat "$0.text"; sed -n \'/^#/,$p\' "$1"; } > "$1.new" && mv "$1.new" "$1"\n',
    {
      mode: 0o755,
    },
  )
  writeFileSync(`${editor}.text`, edited)

  return spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args],
    { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...ENV, GIT_EDITOR: editor } },
  )
}

/** Commits in `root` with `args` through the script installed as the commit-msg hook. */
export function commitThroughHook(root: string, ...args: string[]): SpawnSyncReturns<string> {
  return gitThroughHook(root, '', 'commit', '-q', ...args)
}

/** A take's message: `subject`, then each of `trailers` in a paragraph of its own. */
export function message(subject: string, ...trailers: string[]): string {
  return [subject, ...trailers.map((trailer) => `\n${trailer}`)].join('\n').concat('\n')
}

/** Picks `commits` without committing, as a take does. */
export function pick(root: string, ...commits: string[]): void {
  author(root, 'cherry-pick', '--no-commit', ...commits)
}

/** What a passing check prints and answers. */
export function passes(result: SpawnSyncReturns<string>): void {
  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
}

/** What a refusing check answers, its message holding each of `parts`. */
export function refuses(result: SpawnSyncReturns<string>, ...parts: string[]): void {
  expect(result.status).toBe(1)

  for (const part of parts) {
    expect(result.stderr).toContain(part)
  }
}

/** Removes the checkouts the tests made: each spec runs it `afterEach` test, since a hook registered here would bind to the first spec that imports this module alone. */
export function removeMade(): void {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
}
