/**
 * What the commit git is making right now holds, read for the hooks' checks: whether it is a
 * merge's, and the files it stages. Shared by the checks of what a commit may hold on which branch
 * (`contract-trunk.ts`, `contract-take.ts`).
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Set by the hook git runs before an automatic merge's commit (`lefthook.yml`). */
export const MERGE_HOOK = 'CONTRACT_AHEAD_MERGE'

/** What a git command answered: its exit status and what it printed. */
export interface GitRun {
  readonly status: number | null
  readonly out: string
}

/** Runs git with `args`, `input` on its standard input when given, and its errors on ours. */
export function git(args: readonly string[], input?: string): GitRun {
  const run = spawnSync('git', [...args], {
    encoding: 'utf8',
    input,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'],
  })

  return { status: run.status, out: run.stdout }
}

/**
 * Whether the commit is a merge's: one that waits for its commit (after a conflict, or
 * `--no-commit`) has a MERGE_HEAD, and the hook before an automatic merge's commit, which has
 * none yet, says so in its variable.
 */
export function merging(): boolean {
  if (process.env[MERGE_HOOK] === '1') {
    return true
  }

  const { status, out } = git(['rev-parse', '--git-path', 'MERGE_HEAD'])

  return status === 0 && existsSync(out.trim())
}

/**
 * The files the commit stages, a move as both its paths and a submodule even where the
 * configuration ignores it, or undefined when git fails.
 */
export function stagedFiles(): readonly string[] | undefined {
  const { status, out } = git([
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '--ignore-submodules=none',
    '-z',
  ])

  return status === 0 ? out.split('\0').filter((file) => file !== '') : undefined
}
