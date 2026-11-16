import { describe, expect, it } from 'vitest'

import { coverageDrift } from './coverage-drift'
import { COVERAGE_END, COVERAGE_START } from './note'

const FILE = 'contract/COVERAGE.md'

const note = (block: string): string =>
  `# Coverage\n\nProse before.\n\n${COVERAGE_START}\n\n${block}\n\n${COVERAGE_END}\n\n## How it is counted\n\nProse after.\n`

const STALE = [
  {
    file: FILE,
    line: 5,
    message:
      'the coverage block is not what `bun run contract:coverage --write` writes; run it to rewrite the block',
  },
]

describe('coverageDrift', () => {
  it('finds nothing when the note holds the block as the coverage writes it', () => {
    expect(coverageDrift(note('| same |'), '| same |')).toEqual([])
  })
  it('finds a block the coverage would write otherwise, at the line of its start marker', () => {
    expect(coverageDrift(note('| old |'), '| new |')).toEqual(STALE)
  })
  it('finds a block that differs only in the blank lines the coverage writes around it', () => {
    const tight = `# Coverage\n\nProse before.\n\n${COVERAGE_START}\n| same |\n${COVERAGE_END}\n`

    expect(coverageDrift(tight, '| same |')).toEqual(STALE)
  })
  it('refuses a note without one start marker before one end marker, as the coverage does', () => {
    expect(() => coverageDrift('no markers', 'x')).toThrow(
      'the note needs one <!-- coverage:start --> before one <!-- coverage:end -->',
    )
  })
})
