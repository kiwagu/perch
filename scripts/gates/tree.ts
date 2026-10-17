/**
 * Tree identities for the verification receipts. A receipt says "this suite
 * passed on exactly this content", so it is keyed by the git tree id of the
 * content, never by a branch name or a commit: a tree id only matches when
 * every tracked file is byte-identical.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const GATES = ['db', 'e2e'] as const

export type Gate = (typeof GATES)[number]

export function isGate(value: string): value is Gate {
  return (GATES as readonly string[]).includes(value)
}

function git(args: readonly string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', [...args], {
    encoding: 'utf8',
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
}

export function topLevel(): string {
  return git(['rev-parse', '--show-toplevel'])
}

export function currentBranch(): string | undefined {
  try {
    return git(['symbolic-ref', '--short', '-q', 'HEAD'])
  } catch {
    return undefined
  }
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

export function receiptPath(gate: Gate, treeId: string): string {
  return join(topLevel(), '.gates', gate, treeId)
}
