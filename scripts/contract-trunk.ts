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

import { DOMAIN_DIR, isBusinessFile, SCENARIOS_DIR, VOCABULARY_FILE } from '@workspace/ui-contract'

import { headRef } from './gates/tree.ts'
import { merging, stagedFiles } from './staged-commit.ts'

const TRUNK = 'contract/trunk'

const TRUNK_REF = `refs/heads/${TRUNK}`

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
