/**
 * Pre-commit check for the landing branch. A commit on `main` lands a reviewed
 * branch, and it is accepted only when the whole database suites and the whole
 * end-to-end suites have passed on exactly the tree being committed.
 * `bun run test:db` and `CI=1 bun run test:e2e`, run without arguments, record
 * one receipt per tree under `.gates/` (a run given a spec or a filter records
 * none); this check looks the index tree up there. A landing that also stages a file of the
 * contract engine must pass `bun run contract:inflight` too: no branch in flight may break under
 * the engine it lands, and the refusal names the branches that would. The round is read from the
 * staged files against HEAD, which on `main` is what the landing adds. On any other branch, or on
 * a detached HEAD, the check does nothing. The branch is told by its full ref, so a tag named
 * `main` changes nothing, and a commit git cannot tell the branch or the staged files of fails.
 *
 * Usage: bun run scripts/gates/check-main-gates.ts [--branch <name>]
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

import { stagedFiles } from '../staged-commit.ts'

import { FULL_RUN_SCRIPT } from './full-run.ts'
import { GATES, headRef, indexTreeId, receiptPath, topLevel } from './tree.ts'

const LANDING_BRANCH = 'main'

const LANDING_REF = `refs/heads/${LANDING_BRANCH}`

/** The contract engine's folder: a round that stages a file in it may break a branch in flight. */
const ENGINE_DIR = 'packages/ui-contract'

/** The root script that loads the contract of every branch in flight with the engine at hand. */
const INFLIGHT_SCRIPT = 'contract:inflight'

const INFLIGHT_COMMAND = `bun run ${INFLIGHT_SCRIPT}`

/**
 * Whether the commit lands: on the branch `--branch` names, or else on the branch HEAD is on,
 * told by its full ref; undefined when git cannot tell.
 */
function landing(argv: readonly string[]): boolean | undefined {
  const index = argv.indexOf('--branch')

  if (index !== -1) {
    return argv[index + 1] === LANDING_BRANCH
  }

  const ref = headRef()

  return ref === undefined ? undefined : ref === LANDING_REF
}

/** The branches the check's report heads with `<branch>: <n> problem(s)`, in its order. */
function brokenBranches(report: string): string[] {
  return report.split('\n').flatMap((line) => {
    const branch = /^(\S+): \d+ problems?$/.exec(line)?.[1]

    return branch === undefined ? [] : [branch]
  })
}

/**
 * Runs the check of the branches in flight and says why the landing is refused, as lines;
 * none when it passes. A run that names no broken branch (it did not finish, or failed) is
 * refused as well, with what it printed.
 */
function inflightRefusal(): string[] {
  const run = spawnSync(process.execPath, ['run', '--silent', INFLIGHT_SCRIPT], {
    cwd: topLevel(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (run.status === 0) {
    return []
  }

  const broken = brokenBranches(run.stdout)
  const lead = `gates: this landing changes ${ENGINE_DIR}, and`

  if (broken.length > 0) {
    return [
      `${lead} these branches in flight would break:`,
      ...broken.map((branch) => `  ${branch}`),
      `gates: \`${INFLIGHT_COMMAND}\` shows what breaks in each.`,
    ]
  }

  const how = run.status === null ? 'it did not finish' : `exit ${run.status}`
  const printed = `${run.stdout}${run.stderr}`.trimEnd().split('\n')

  return [
    `${lead} the in-flight check failed (${how}) without naming a branch:`,
    ...printed.map((line) => `  ${line}`),
    `gates: \`${INFLIGHT_COMMAND}\` runs it again.`,
  ]
}

function main(argv: readonly string[]): number {
  const lands = landing(argv)

  if (lands === undefined) {
    console.error('gates: git cannot tell the branch this commit is on.')

    return 1
  }

  if (!lands) {
    return 0
  }

  const files = stagedFiles()

  if (files === undefined) {
    console.error('gates: git cannot list the files this commit stages.')

    return 1
  }

  const treeId = indexTreeId()
  const missing = GATES.filter((gate) => !existsSync(receiptPath(gate, treeId)))
  const touchesEngine = files.some((file) => file.startsWith(`${ENGINE_DIR}/`))
  const refusal = touchesEngine ? inflightRefusal() : []

  if (missing.length === 0 && refusal.length === 0) {
    const checked = touchesEngine ? ' and no branch in flight breaks' : ''

    console.log(`gates: db and e2e suites passed on tree ${treeId}${checked}, landing allowed`)

    return 0
  }

  if (missing.length > 0) {
    console.error(`gates: a commit on ${LANDING_BRANCH} needs green suites on tree ${treeId}.`)
    console.error('gates: missing receipts:')

    for (const gate of missing) {
      console.error(
        `  ${gate}: run \`${FULL_RUN_SCRIPT[gate]}\` without arguments on this exact content, then commit again`,
      )
    }
  }

  for (const line of refusal) {
    console.error(line)
  }

  return 1
}

process.exit(main(process.argv.slice(2)))
