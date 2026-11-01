import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sampleContract } from '../check/contract.fixture'
import { formatProblem } from '../files'

import { compareConsumers } from './compare'
import { collectFromTest, RUNTIME_TEST_ANCHOR } from './scan'

const FIXTURES = join(import.meta.dirname, '../__fixtures__/consumers')

const collected = (name: string) =>
  collectFromTest(readFileSync(join(FIXTURES, name), 'utf8'), `consumers/${name}`)

const printed = (names: readonly string[]): string[] =>
  compareConsumers(names.map(collected), sampleContract()).map(formatProblem)

describe('compareConsumers', () => {
  it('finds nothing when every literal is a known anchor, a code, a state or a choice value', () => {
    expect(printed(['known.ts'])).toEqual([])
  })
  it('reports each literal the contract does not know at its line, quoted, with what it is not', () => {
    expect(printed(['unknown.ts'])).toEqual([
      'consumers/unknown.ts:5: "sample.other-button" is not a declared anchor',
      'consumers/unknown.ts:6: "sample.gone-input" is not a declared anchor',
      'consumers/unknown.ts:7: "sample.list.option" is not a declared anchor',
      'consumers/unknown.ts:8: "lost" is not a code of the vocabulary',
      'consumers/unknown.ts:9: "stuck" is not a state of the vocabulary',
      'consumers/unknown.ts:10: "c" is not a choice value of the vocabulary',
    ])
  })
  it('reports a code, a state or a value toHaveAttribute asserts the same way', () => {
    expect(printed(['attributes.ts'])).toEqual([
      'consumers/attributes.ts:10: "lost" is not a code of the vocabulary',
      'consumers/attributes.ts:15: "c" is not a choice value of the vocabulary',
    ])
  })
  it('resolves a template without an expression and a wrapped string as it resolves a quoted one', () => {
    expect(printed(['static.ts']).filter((line) => !line.endsWith(RUNTIME_TEST_ANCHOR))).toEqual([])
  })
  it('resolves a + chain of strings as the string it folds to, and refuses one an expression completes', () => {
    expect(printed(['concatenated.ts'])).toEqual([
      `consumers/concatenated.ts:7: ${RUNTIME_TEST_ANCHOR}`,
      'consumers/concatenated.ts:8: "sample.gone-page" is not a declared anchor',
      `consumers/concatenated.ts:11: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/concatenated.ts:13: ${RUNTIME_TEST_ANCHOR}`,
    ])
  })
  it('resolves a selector whose attribute name a + chain or an escape splits', () => {
    expect(printed(['split-name.ts'])).toEqual([
      `consumers/split-name.ts:7: ${RUNTIME_TEST_ANCHOR}`,
      'consumers/split-name.ts:8: "sample.gone-page" is not a declared anchor',
    ])
  })
  it('keeps the anchors built at runtime, sorted with the rest by file and line', () => {
    expect(printed(['unknown.ts', 'runtime.ts', 'known.ts'])).toEqual([
      `consumers/runtime.ts:7: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/runtime.ts:8: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/runtime.ts:9: ${RUNTIME_TEST_ANCHOR}`,
      'consumers/unknown.ts:5: "sample.other-button" is not a declared anchor',
      'consumers/unknown.ts:6: "sample.gone-input" is not a declared anchor',
      'consumers/unknown.ts:7: "sample.list.option" is not a declared anchor',
      'consumers/unknown.ts:8: "lost" is not a code of the vocabulary',
      'consumers/unknown.ts:9: "stuck" is not a state of the vocabulary',
      'consumers/unknown.ts:10: "c" is not a choice value of the vocabulary',
    ])
  })
})
