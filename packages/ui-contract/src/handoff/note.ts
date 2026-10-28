/**
 * The coverage note, `contract/COVERAGE.md`: prose written by hand around a block that
 * `ui-contract coverage --write` replaces, between two marker lines.
 */

export const COVERAGE_START = '<!-- coverage:start -->'
export const COVERAGE_END = '<!-- coverage:end -->'

const occurrences = (text: string, marker: string): number => text.split(marker).length - 1

/** The note with `block` between its markers; the text outside them is left as it is. */
export function replaceCoverageBlock(note: string, block: string): string {
  const start = note.indexOf(COVERAGE_START)
  const end = note.indexOf(COVERAGE_END)

  if (
    occurrences(note, COVERAGE_START) !== 1 ||
    occurrences(note, COVERAGE_END) !== 1 ||
    end < start
  ) {
    throw new Error(`the note needs one ${COVERAGE_START} before one ${COVERAGE_END}`)
  }

  const head = note.slice(0, start + COVERAGE_START.length)

  return `${head}\n\n${block}\n\n${note.slice(end)}`
}
