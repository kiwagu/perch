/**
 * Runs the unit tests of the pre-commit hook in the mode the branch takes. On `main`, the
 * landing, every app machine is held to its whole flow: the command runs without the ahead
 * mode, and so it does on a detached HEAD, which names no branch to run ahead on. On a branch a business commit may run ahead of its implementation: the command runs
 * with `CONTRACT_AHEAD=1`, `CONTRACT_AHEAD_BASE`, the merge base of HEAD and the local `main`,
 * at whose flows a machine may still be (during a merge, the base the merge's commit will have,
 * so a merge of `main` compares the app it brings with the flows it brings), and
 * `CONTRACT_AHEAD_HEAD`, the commit the branch is at, whose flows the app was built from. During
 * a merge that commit is the tip before it, which the engine the merge brings may no longer read
 * (a key it now requires): then the merge runs without it, held to its base alone, while outside
 * a merge the tests report a HEAD whose contract does not load. Both
 * are named here rather than read by the tests, so the test cache, keyed by them, never carries
 * a pass made against one branch state into another with the same files. When
 * that merge base cannot be found (no local `main`, or no history shared with it), or an
 * automatic merge does not say what it brings in, nothing runs and the hook fails: a branch
 * never falls back to a comparison without its base.
 *
 * Usage: bun run scripts/contract-ahead.ts <command> [args...], with `CONTRACT_AHEAD_MERGE=1`
 * from the hook git runs before an automatic merge's commit.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { contractAt } from '@workspace/ui-contract'

const LANDING_BRANCH = 'main'

/** Set by the hook git runs before an automatic merge's commit (`lefthook.yml`). */
const MERGE_HOOK = 'CONTRACT_AHEAD_MERGE'

/** The variables of this script, which the command never inherits; the ahead mode sets three. */
const OWN_VARIABLES = new Set([
  'CONTRACT_AHEAD',
  'CONTRACT_AHEAD_BASE',
  'CONTRACT_AHEAD_HEAD',
  MERGE_HOOK,
])

const NO_MERGE_BASE =
  'unit tests: no merge base of HEAD and the local branch main (main is missing, or this branch shares no history with it), so the machines cannot be compared with their flows at the branch base. Fetch main (git fetch origin main:main) or merge it into this branch, then commit again.'

/** Why an automatic merge whose reflog action names no commit it brings in cannot be checked. */
const unknownMerge = (action: string): string =>
  `unit tests: cannot tell the commits this automatic merge brings in from its reflog action (${action}), so the machines cannot be compared with their flows at the base the merge will have. Merge with --no-commit, then commit.`

type Mode =
  | { readonly kind: 'strict' }
  | { readonly kind: 'ahead'; readonly base: string; readonly head: string | undefined }
  | { readonly kind: 'stop'; readonly problem: string }

/** The commits a merge in progress brings in, or why they cannot be told. */
type Incoming = { readonly heads: readonly string[] } | { readonly problem: string }

/** What git prints for `args`, or undefined when it fails. */
function git(args: readonly string[]): string | undefined {
  const run = spawnSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  return run.status === 0 ? run.stdout.trim() : undefined
}

/** Whether the engine here reads the contract `revision` holds, in the repository at `root`. */
function readsContractAt(revision: string, root: string): boolean {
  try {
    contractAt(revision, root)

    return true
  } catch {
    return false
  }
}

/** The lines of `text` that hold something. */
function lines(text: string): readonly string[] {
  return text.split('\n').filter((line) => line !== '')
}

/** The text of the file `name` of the git directory, or undefined when there is none. */
function gitFile(name: string): string | undefined {
  const path = git(['rev-parse', '--git-path', name])

  return path !== undefined && existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

/** The commits FETCH_HEAD marks for a merge: what a pull merges. */
function fetchedForMerge(): readonly string[] {
  return lines(gitFile('FETCH_HEAD') ?? '').flatMap((line) => {
    const [commit, mark] = line.split('\t')

    return commit !== undefined && mark === '' ? [commit] : []
  })
}

/**
 * The commits a merge in progress brings in, none outside a merge. While the merge waits for its
 * commit (after a conflict, or `--no-commit`), MERGE_HEAD names them. The hook before an
 * automatic merge's commit has no MERGE_HEAD, only the merge's reflog action: `merge <commits>`,
 * where git itself writes the upstream and FETCH_HEAD's commits, or `pull ...`, whose commits
 * FETCH_HEAD marks. A reflog action anywhere else is not a merge's and is ignored.
 */
function incoming(): Incoming {
  const mergeHead = gitFile('MERGE_HEAD')

  if (mergeHead !== undefined) {
    return { heads: lines(mergeHead) }
  }

  if (process.env[MERGE_HOOK] !== '1') {
    return { heads: [] }
  }

  const action = process.env['GIT_REFLOG_ACTION'] ?? ''
  const [command, ...names] = action.split(' ').filter((word) => word !== '')
  const named = command === 'merge' ? names : command === 'pull' ? fetchedForMerge() : []
  const heads = named.flatMap((name) => {
    const head = git(['rev-parse', '--verify', '-q', `${name}^{commit}`])

    return head === undefined ? [] : [head]
  })

  return named.length > 0 && heads.length === named.length
    ? { heads }
    : { problem: unknownMerge(action) }
}

function modeOf(): Mode {
  const branch = git(['branch', '--show-current'])

  if (branch === LANDING_BRANCH || branch === '') {
    return { kind: 'strict' }
  }

  const merge = incoming()

  if ('problem' in merge) {
    return { kind: 'stop', problem: merge.problem }
  }

  // With the commits a merge brings in, the merge base of main and the merge's commit to be.
  const base = git(['merge-base', `refs/heads/${LANDING_BRANCH}`, 'HEAD', ...merge.heads])
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'])
  const root = git(['rev-parse', '--show-toplevel'])

  if (base === undefined || base === '' || head === undefined || root === undefined) {
    return { kind: 'stop', problem: NO_MERGE_BASE }
  }

  // The tip before a merge, whose contract the engine the merge brings cannot read, gives no flows.
  const merging = merge.heads.length > 0

  return { kind: 'ahead', base, head: merging && !readsContractAt(head, root) ? undefined : head }
}

function usage(): never {
  console.error('Usage: bun run scripts/contract-ahead.ts <command> [args...]')
  process.exit(2)
}

function main(argv: readonly string[]): number {
  const [command, ...args] = argv

  if (command === undefined) {
    usage()
  }

  const mode = modeOf()

  if (mode.kind === 'stop') {
    console.error(mode.problem)

    return 1
  }

  const strict = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !OWN_VARIABLES.has(name)),
  )
  const run = spawnSync(command, args, {
    stdio: 'inherit',
    env:
      mode.kind === 'strict'
        ? strict
        : {
            ...strict,
            CONTRACT_AHEAD: '1',
            CONTRACT_AHEAD_BASE: mode.base,
            ...(mode.head === undefined ? {} : { CONTRACT_AHEAD_HEAD: mode.head }),
          },
  })

  if (run.error) {
    console.error(`unit tests: could not start ${command}: ${run.error.message}`)

    return 1
  }

  return run.status ?? 1
}

process.exit(main(process.argv.slice(2)))
