/**
 * Pre-commit check for the landing branch. A commit on `main` lands a reviewed
 * branch, and it is accepted only when the whole database suites and the whole
 * end-to-end suites have passed on exactly the tree being committed.
 * `bun run test:db` and `CI=1 bun run test:e2e`, run without arguments, record
 * one receipt per tree under `.gates/` (a run given a spec or a filter records
 * none); this check looks the index tree up there. On any other branch it does
 * nothing.
 *
 * Usage: bun run scripts/gates/check-main-gates.ts [--branch <name>]
 */

import { existsSync } from 'node:fs'

import { FULL_RUN_SCRIPT } from './full-run.ts'
import { currentBranch, GATES, indexTreeId, receiptPath } from './tree.ts'

const LANDING_BRANCH = 'main'

function branchFrom(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--branch')

  if (index === -1) {
    return currentBranch()
  }

  return argv[index + 1]
}

function main(argv: readonly string[]): number {
  const branch = branchFrom(argv)

  if (branch !== LANDING_BRANCH) {
    return 0
  }

  const treeId = indexTreeId()
  const missing = GATES.filter((gate) => !existsSync(receiptPath(gate, treeId)))

  if (missing.length === 0) {
    console.log(`gates: db and e2e suites passed on tree ${treeId}, landing allowed`)

    return 0
  }

  console.error(`gates: a commit on ${LANDING_BRANCH} needs green suites on tree ${treeId}.`)
  console.error('gates: missing receipts:')

  for (const gate of missing) {
    console.error(
      `  ${gate}: run \`${FULL_RUN_SCRIPT[gate]}\` without arguments on this exact content, then commit again`,
    )
  }

  return 1
}

process.exit(main(process.argv.slice(2)))
