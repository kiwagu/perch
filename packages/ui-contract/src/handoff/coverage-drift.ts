/**
 * Whether the coverage note is current: its generated block is what `ui-contract coverage
 * --write` would write, the text around it aside, so a change that moves what the block measures
 * and leaves the block behind fails `contract:coverage:check`.
 */

import { COVERAGE_FILE, type Problem } from '../files'

import { COVERAGE_START, replaceCoverageBlock } from './note'

const REWRITE = 'bun run contract:coverage --write'

/**
 * Nothing when `note` holds `block` as the coverage writes it; else one problem at the line of
 * its start marker, naming the command that rewrites it.
 */
export function coverageDrift(note: string, block: string): Problem[] {
  return replaceCoverageBlock(note, block) === note
    ? []
    : [
        {
          file: COVERAGE_FILE,
          line: note.slice(0, note.indexOf(COVERAGE_START)).split('\n').length,
          message: `the coverage block is not what \`${REWRITE}\` writes; run it to rewrite the block`,
        },
      ]
}
