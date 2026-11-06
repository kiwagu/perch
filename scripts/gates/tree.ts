/**
 * Tree identities for the verification receipts. A receipt says "this suite
 * passed on exactly this content", so it is keyed by the git tree id of the
 * content, never by a branch name or a commit: a tree id only matches when
 * every tracked file is byte-identical.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const GATES = ['db', 'e2e'] as const

export type Gate = (typeof GATES)[number]

export function isGate(value: string): value is Gate {
  return (GATES as readonly string[]).includes(value)
}

function git(args: readonly string[], env?: NodeJS.ProcessEnv, cwd?: string): string {
  return execFileSync('git', [...args], {
    encoding: 'utf8',
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
    ...(cwd === undefined ? {} : { cwd }),
  }).trim()
}

export function topLevel(): string {
  return git(['rev-parse', '--show-toplevel'])
}

/**
 * The full ref of the branch HEAD is on (`refs/heads/main`), `''` on a detached HEAD, which
 * `symbolic-ref` answers with status 1, or undefined when git cannot tell. Never the short name:
 * beside a tag of the same name, `symbolic-ref --short` prints `heads/<branch>`.
 */
export function headRef(): string | undefined {
  const run = spawnSync('git', ['symbolic-ref', '--quiet', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  if (run.status === 0) {
    return run.stdout.trim()
  }

  return run.status === 1 ? '' : undefined
}

/** The tree that `git commit` would record right now: the index. */
export function indexTreeId(): string {
  return git(['write-tree'])
}

/**
 * The tree of the working directory as it is on disk, tracked and untracked
 * files alike (ignored files excluded), built in a throwaway index so the real
 * index is never touched.
 */
export function workingTreeId(): string {
  const scratch = mkdtempSync(join(tmpdir(), 'gates-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') }

  try {
    git(['read-tree', 'HEAD'], env)
    git(['add', '-A'], env)

    return git(['write-tree'], env)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/**
 * When each file of the working tree was last written, and its size, by path: tracked and
 * untracked files alike, ignored ones excluded, a file gone from disk stamped `missing`. A file
 * edited and put back to the same bytes keeps the tree id but not its stamp.
 */
export function fileStamps(): ReadonlyMap<string, string> {
  const root = topLevel()
  const paths = git(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    undefined,
    root,
  )
    .split('\0')
    .filter((path) => path !== '')

  return new Map(
    paths.map((path) => {
      try {
        const { size, mtimeMs } = statSync(join(root, path))

        return [path, `${size}:${mtimeMs}`] as const
      } catch {
        return [path, 'missing'] as const
      }
    }),
  )
}

/** The paths whose stamp differs between two readings, or that only one of them has. */
export function changedFiles(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()])

  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort()
}

export function receiptPath(gate: Gate, treeId: string): string {
  return join(topLevel(), '.gates', gate, treeId)
}
