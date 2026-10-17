/**
 * Pre-commit check for the landing branch. A commit on `main` lands a reviewed
 * branch, and it is accepted only when the database suites and the end-to-end
 * suites have passed on exactly the tree being committed. `bun run test:db`
 * and `CI=1 bun run test:e2e` record one receipt per tree under `.gates/`;
 * this check looks the index tree up there. On any other branch it does
 * nothing.
 *
 * Usage: bun run scripts/gates/check-main-gates.ts [--branch <name>]
 */

import { existsSync } from 'node:fs'

import { currentBranch, GATES, indexTreeId, receiptPath } from './tree.ts'

const LANDING_BRANCH = 'main'

const HOW_TO: Readonly<Record<(typeof GATES)[number], string>> = {
  db: 'bun run test:db',
  e2e: 'CI=1 bun run test:e2e',
}

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
    console.error(`  ${gate}: run \`${HOW_TO[gate]}\` on this exact content, then commit again`)
  }

  return 1
}

process.exit(main(process.argv.slice(2)))
