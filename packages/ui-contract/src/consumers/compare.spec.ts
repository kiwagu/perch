import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sampleContract, screenIn } from '../check/contract.fixture'
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
  it("takes an input's visibility-button with its values show and hide, and no other value", () => {
    const contract = sampleContract()
    const visibility = [collected('visibility.ts')]

    expect(compareConsumers(visibility, contract).map(formatProblem)).toEqual([
      'consumers/visibility.ts:6: "sample.title-input.visibility-button" is not a declared anchor',
      'consumers/visibility.ts:9: "sample.title-input.visibility-button" is not a declared anchor',
      'consumers/visibility.ts:9: "show" is not a choice value of the vocabulary',
      'consumers/visibility.ts:11: "hide" is not a choice value of the vocabulary',
      'consumers/visibility.ts:12: "peek" is not a choice value of the vocabulary',
    ])

    Object.assign(screenIn(contract, 'sample').anchors['sample.title-input'] ?? {}, {
      derived: ['visibility-button'],
    })

    expect(compareConsumers(visibility, contract).map(formatProblem)).toEqual([
      'consumers/visibility.ts:12: "peek" is not a choice value of the vocabulary',
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
  it('reports a code, a state or a value its anchor never carries, once the literal itself is known', () => {
    expect(printed(['paired.ts'])).toEqual([
      'consumers/paired.ts:11: sample.list never carries state current',
      'consumers/paired.ts:13: sample.thing-item never carries state loading',
      'consumers/paired.ts:15: sample.save-button never carries state current',
      'consumers/paired.ts:18: sample.thing-item never carries state loading',
      'consumers/paired.ts:22: "lost" is not a code of the vocabulary',
      'consumers/paired.ts:31: sample.list never carries state current',
    ])
  })
  it('holds an attribute after a :has(...) to the element before it, and one beside a :not([data-testid]) to no anchor', () => {
    const problems = compareConsumers([collected('paired.ts')], sampleContract())

    expect(problems.filter(({ line }) => (line ?? 0) > 23).map(formatProblem)).toEqual([
      'consumers/paired.ts:31: sample.list never carries state current',
    ])
  })
  it('pairs through what the anchors under it carry, as the scenarios check does', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').anchors['sample.list.first-item'] = {
      kind: 'item',
      states: ['current'],
    }

    expect(compareConsumers([collected('paired.ts')], contract).map(formatProblem)).toEqual([
      'consumers/paired.ts:13: sample.thing-item never carries state loading',
      'consumers/paired.ts:15: sample.save-button never carries state current',
      'consumers/paired.ts:18: sample.thing-item never carries state loading',
      'consumers/paired.ts:22: "lost" is not a code of the vocabulary',
    ])
  })
  it('leaves the pairing to an anchor the contract does not declare, which is a problem of its own', () => {
    const text = `page.locator('[data-testid="sample.gone-list"][data-state="current"]')\n`

    expect(
      compareConsumers([collectFromTest(text, 'a.ts')], sampleContract()).map(formatProblem),
    ).toEqual(['a.ts:1: "sample.gone-list" is not a declared anchor'])
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
