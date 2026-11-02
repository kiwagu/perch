/**
 * Runs the unit tests of the pre-commit hook in the mode the branch takes. On `main`, the
 * landing, every app machine is held to its whole flow: the command runs without the ahead
 * mode, and so it does on a detached HEAD, which names no branch to run ahead on. On a branch a business commit may run ahead of its implementation: the command runs
 * with `CONTRACT_AHEAD=1` and `CONTRACT_AHEAD_BASE`, the merge base of HEAD and the local
 * `main`, at whose flows a machine may still be; during a merge, the base the merge's commit
 * will have, so a merge of `main` compares the app it brings with the flows it brings. When
 * that merge base cannot be found (no
 * local `main`, or no history shared with it), nothing runs and the hook fails: a branch never
 * falls back to a comparison without its base.
 *
 * Usage: bun run scripts/contract-ahead.ts <command> [args...]
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const LANDING_BRANCH = 'main'

/** The variables of the ahead mode, which the strict mode leaves unset. */
const AHEAD_VARIABLES = new Set(['CONTRACT_AHEAD', 'CONTRACT_AHEAD_BASE'])

const NO_MERGE_BASE =
  'unit tests: no merge base of HEAD and the local branch main (main is missing, or this branch shares no history with it), so the machines cannot be compared with their flows at the branch base. Fetch main (git fetch origin main:main) or merge it into this branch, then commit again.'

type Mode =
  | { readonly kind: 'strict' }
  | { readonly kind: 'ahead'; readonly base: string }
  | { readonly kind: 'no-base' }

/** What git prints for `args`, or undefined when it fails. */
function git(args: readonly string[]): string | undefined {
  const run = spawnSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  return run.status === 0 ? run.stdout.trim() : undefined
}

/**
 * The heads a merge in progress brings in, none outside a merge: those of MERGE_HEAD while the
 * merge waits for its commit (after a conflict, or `--no-commit`), else those its reflog action
 * names, which is all an automatic merge leaves its hook, since git writes no MERGE_HEAD there.
 */
function incomingHeads(): readonly string[] {
  const mergeHead = git(['rev-parse', '--git-path', 'MERGE_HEAD'])

  if (mergeHead !== undefined && existsSync(mergeHead)) {
    return readFileSync(mergeHead, 'utf8')
      .split('\n')
      .filter((head) => head !== '')
  }

  const merging = /^merge (.+)$/.exec(process.env['GIT_REFLOG_ACTION'] ?? '')?.[1]

  return merging === undefined ? [] : merging.split(' ').filter((head) => head !== '')
}

function modeOf(): Mode {
  const branch = git(['branch', '--show-current'])

  if (branch === LANDING_BRANCH || branch === '') {
    return { kind: 'strict' }
  }

  // With the heads a merge brings in, the merge base of main and the merge's commit to be.
  const base = git(['merge-base', `refs/heads/${LANDING_BRANCH}`, 'HEAD', ...incomingHeads()])

  return base === undefined || base === '' ? { kind: 'no-base' } : { kind: 'ahead', base }
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

  if (mode.kind === 'no-base') {
    console.error(NO_MERGE_BASE)

    return 1
  }

  const strict = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !AHEAD_VARIABLES.has(name)),
  )
  const run = spawnSync(command, args, {
    stdio: 'inherit',
    env:
      mode.kind === 'strict'
        ? strict
        : { ...strict, CONTRACT_AHEAD: '1', CONTRACT_AHEAD_BASE: mode.base },
  })

  if (run.error) {
    console.error(`unit tests: could not start ${command}: ${run.error.message}`)

    return 1
  }

  return run.status ?? 1
}

process.exit(main(process.argv.slice(2)))
