/**
 * How a take from the contract trunk is written, which every refusal of the take check ends with.
 */

import { DOMAIN_DIR, SCENARIOS_DIR, VOCABULARY_FILE } from '@workspace/ui-contract'

export const TRUNK = 'contract/trunk'

/** The trailer of a take: the trunk's commits it carries, then its cards. */
export const TAKEN = 'Taken-from'

/** The trailer of a business commit the rules let an area branch write itself. */
export const WRITTEN = 'Written-on-branch'

/** The trailer of a landing on `main`: the branch it squashes, the branch's tip, then its cards. */
export const SQUASHED = 'Squashed-from'

export const LAYER = `${DOMAIN_DIR}/, ${VOCABULARY_FILE}, ${SCENARIOS_DIR}/`

export const TAKEN_FORM = `${TAKEN}: ${TRUNK} <first>^..<last> <card>`

export const WRITTEN_FORM = `${WRITTEN}: <card>`

export const SQUASH_FORM = `git merge --squash <branch>, committed with -m "<type>(<scope>): <goal>" -m "${SQUASHED}: <branch> (<tip>) <card>"`

/** A card's label on the board, as a squash's trailer names it too. */
export const CARD = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/

/**
 * The branches whose round is not judged at a landing: the contract engine's, whose meta commits
 * carry the `contract` scope with the engine's own files.
 */
export const UNJUDGED_BRANCHES: readonly string[] = ['feat/contract-first-pass']

/** Whether `branch` never lands on `main`: the trunk, and an experiment, which is split first. */
export const NEVER_LANDS = (branch: string): boolean =>
  branch === TRUNK || branch.startsWith('experiment/')

export const FORM = [
  "A take is the card's trunk commits picked (git cherry-pick --no-commit <commits, oldest first>) and committed alone:",
  `  git commit -m "<type>(contract): <the card's goal>" -m "${TAKEN_FORM}"`,
  `with each commit named or a run of them, oldest first, and every card. A business commit the rules let this branch write itself (the last one of a rename or a removal, a feature begun here before the trunk, an amendment allowed here) ends with "${WRITTEN_FORM}" instead.`,
].join('\n')

export function listed(files: readonly string[]): string {
  return files.map((file) => `  ${file}`).join('\n')
}
