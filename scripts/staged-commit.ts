/**
 * What the commit git is making right now holds, read for the hooks' checks: whether it is a
 * merge's or an amend's, and the files it stages. Shared by the checks of what a commit may hold on
 * which branch (`contract-trunk.ts`, `contract-take.ts`).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

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

/** How far up its process tree a hook's check looks for the git command that runs it. */
const ANCESTORS = 16

/** The parent of process `pid`, read from /proc, or undefined. */
function parentOf(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])

    return Number.isSafeInteger(parent) && parent > 1 ? parent : undefined
  } catch {
    return undefined
  }
}

/** The arguments of the nearest git command above this process, or undefined where /proc has none. */
function gitCommand(): readonly string[] | undefined {
  let pid: number | undefined = process.ppid

  for (let level = 0; pid !== undefined && level < ANCESTORS; level += 1) {
    let argv: readonly string[]

    try {
      argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
    } catch {
      return undefined
    }

    if (basename(argv[0] ?? '') === 'git') {
      return argv.slice(1)
    }

    pid = parentOf(pid)
  }

  return undefined
}

/**
 * Whether the commit replaces HEAD (`git commit --amend`, or an abbreviation of it git accepts),
 * read from the arguments of the git command that runs the hook: a hook sees only what an amend
 * adds staged, never the whole commit it leaves. False where they cannot be read (no /proc).
 */
export function amending(): boolean {
  return gitCommand()?.some((arg) => arg.length >= 4 && '--amend'.startsWith(arg)) ?? false
}

/**
 * The files the commit stages, against HEAD or against `base`, a move as both its paths and a
 * submodule even where the configuration ignores it, or undefined when git fails.
 */
export function stagedFiles(base?: string): readonly string[] | undefined {
  const { status, out } = git([
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '--ignore-submodules=none',
    '-z',
    ...(base === undefined ? [] : [base]),
  ])

  return status === 0 ? out.split('\0').filter((file) => file !== '') : undefined
}
