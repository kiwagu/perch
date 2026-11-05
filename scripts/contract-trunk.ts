/**
 * Holds a commit on the contract trunk to the business layer. `contract/trunk` carries the UI
 * contract's business layer and nothing else: the domain files, the vocabulary and the scenarios
 * (`isBusinessFile`). A commit there that stages any other file, added, changed or deleted, a
 * move counted by both its paths, a submodule whatever the configuration hides (the app's code or
 * tests, the engine, a generated schema, the coverage report, a rule, a doc), fails, naming each
 * such file and where it belongs. A merge passes, as it brings `main` in with every layer and its
 * conflicts are the modeling session's to resolve; a commit on any other branch, or on a
 * detached HEAD, passes at once. The branch is told by its full ref, so a tag of the same name
 * changes nothing, and a commit git cannot tell the branch or the staged files of fails.
 *
 * Usage: bun run scripts/contract-trunk.ts, from the pre-commit hook, with `CONTRACT_AHEAD_MERGE=1`
 * from the hook git runs before an automatic merge's commit.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { DOMAIN_DIR, isBusinessFile, SCENARIOS_DIR, VOCABULARY_FILE } from '@workspace/ui-contract'

const TRUNK = 'contract/trunk'

const TRUNK_REF = `refs/heads/${TRUNK}`

/** Set by the hook git runs before an automatic merge's commit (`lefthook.yml`). */
const MERGE_HOOK = 'CONTRACT_AHEAD_MERGE'

/** Runs git with `args` and returns its exit status and what it printed. */
function git(args: readonly string[]): { readonly status: number | null; readonly out: string } {
  const run = spawnSync('git', [...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })

  return { status: run.status, out: run.stdout }
}

/**
 * The full ref of the branch HEAD is on, `''` on a detached HEAD, which `symbolic-ref` answers
 * with status 1, or undefined when git cannot tell.
 */
function headRef(): string | undefined {
  const { status, out } = git(['symbolic-ref', '--quiet', 'HEAD'])

  if (status === 0) {
    return out.trim()
  }

  return status === 1 ? '' : undefined
}

/**
 * Whether the commit is a merge's: one that waits for its commit (after a conflict, or
 * `--no-commit`) has a MERGE_HEAD, and the hook before an automatic merge's commit, which has
 * none yet, says so in its variable.
 */
function merging(): boolean {
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
function stagedFiles(): readonly string[] | undefined {
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

/** What the hook says of a commit that stages `outside`, files beyond the business layer. */
function refusal(outside: readonly string[]): string {
  return [
    `contract trunk: a commit on ${TRUNK} holds the business layer alone (${DOMAIN_DIR}/, ${VOCABULARY_FILE}, ${SCENARIOS_DIR}/), and this one also stages:`,
    ...outside.map((file) => `  ${file}`),
    "Each goes on the branch of its own area: the app's code and its tests on the card's area branch, after the OK on its contract; the engine with its schemas, docs and rules on feat/contract-first-pass. Unstage them (git restore --staged <file>) and commit again.",
  ].join('\n')
}

function main(): number {
  const head = headRef()

  if (head === undefined) {
    console.error('contract trunk: git cannot tell the branch this commit is on.')

    return 1
  }

  if (head !== TRUNK_REF || merging()) {
    return 0
  }

  const files = stagedFiles()

  if (files === undefined) {
    console.error('contract trunk: git cannot list the files this commit stages.')

    return 1
  }

  const outside = files.filter((file) => !isBusinessFile(file))

  if (outside.length === 0) {
    return 0
  }

  console.error(refusal(outside))

  return 1
}

process.exit(main())
