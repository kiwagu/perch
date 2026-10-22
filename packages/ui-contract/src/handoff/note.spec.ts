import { describe, expect, it } from 'vitest'

import { COVERAGE_END, COVERAGE_START, replaceCoverageBlock } from './note'

const note = (block: string): string =>
  `# Coverage\n\nProse before.\n\n${COVERAGE_START}\n\n${block}\n\n${COVERAGE_END}\n\n## How it is counted\n\nProse after.\n`

describe('replaceCoverageBlock', () => {
  it('replaces what lies between the markers and nothing else', () => {
    expect(replaceCoverageBlock(note('| old |'), '| new |')).toBe(note('| new |'))
  })
  it('gives the same note when the block is unchanged', () => {
    expect(replaceCoverageBlock(note('| same |'), '| same |')).toBe(note('| same |'))
  })
  it('fills an empty block', () => {
    const empty = `before\n${COVERAGE_START}\n${COVERAGE_END}\nafter\n`

    expect(replaceCoverageBlock(empty, 'table')).toBe(
      `before\n${COVERAGE_START}\n\ntable\n\n${COVERAGE_END}\nafter\n`,
    )
  })
  it('refuses a note without one start marker before one end marker', () => {
    const message = 'the note needs one <!-- coverage:start --> before one <!-- coverage:end -->'

    expect(() => replaceCoverageBlock('no markers', 'x')).toThrow(message)
    expect(() => replaceCoverageBlock(`${COVERAGE_END}\n${COVERAGE_START}`, 'x')).toThrow(message)
    expect(() => replaceCoverageBlock(note('a') + note('b'), 'x')).toThrow(message)
  })
})
