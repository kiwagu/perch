import { describe, expect, it } from 'vitest'

import { sampleContract } from '../check/contract.fixture'
import { formatProblem, type ScreensFile } from '../files'

import type { Collected } from './collect'
import { compareWithContract } from './compare'

const { vocabulary, screens: sample } = sampleContract()

/** A contract of two anchors on one screen. */
const SCREENS: ScreensFile = {
  ...sample,
  screens: [
    {
      id: 'sample',
      title: 'One thing',
      description: 'The one thing of the sample.',
      frame: true,
      bindings: [],
      flag: null,
      entry: ['sample.page'],
      anchors: { 'sample.page': { kind: 'page' }, 'sample.mode-select': { kind: 'select' } },
    },
  ],
  files: ['contract/screens/__root.yaml'],
}

const source = (file: string, part: Partial<Omit<Collected, 'file'>>): Collected => ({
  file,
  literals: [],
  derived: [],
  codes: [],
  problems: [],
  ...part,
})

/** The sources that render the two anchors, derive an option and use a code. */
const agreeing = (): Collected[] => [
  source('a.tsx', {
    literals: [
      { anchor: 'sample.page', form: 'attribute', line: 3 },
      { anchor: 'sample.mode-select', form: 'prop', line: 4 },
    ],
    derived: [{ suffix: 'option', line: 9 }],
    codes: [{ code: 'saved', form: 'attribute', line: 5 }],
  }),
]

const printed = (collected: readonly Collected[]): string[] =>
  compareWithContract(collected, SCREENS, vocabulary).map(formatProblem)

describe('compareWithContract', () => {
  it('finds nothing when the sources render exactly the anchors of the contract', () => {
    expect(printed(agreeing())).toEqual([])
  })
  it('lets the contract run ahead: an anchor not rendered yet passes, one the contract lacks does not', () => {
    const [first] = agreeing()
    const collected = [
      { ...(first ?? expect.unreachable('a source')), literals: [] },
      source('b.tsx', {
        literals: [{ anchor: 'sample.other-button', form: 'attribute', line: 2 }],
      }),
    ]

    expect(
      compareWithContract(collected, SCREENS, vocabulary, { ahead: true }).map(formatProblem),
    ).toEqual([
      'b.tsx:2: "sample.other-button" is not in contract/screens; add it there or rename it',
    ])
  })
  it('keeps every other problem when the contract runs ahead', () => {
    const collected = [
      source('c.tsx', { problems: [{ file: 'c.tsx', line: 9, message: 'built at runtime' }] }),
      ...agreeing(),
      source('b.tsx', {
        literals: [
          { anchor: 'sample.page', form: 'key', line: 7 },
          { anchor: 'sample.mode-select.option', form: 'attribute', line: 6 },
        ],
        derived: [{ suffix: 'thing', line: 8 }],
        codes: [{ code: 'unheard-of', form: 'attribute', line: 5 }],
      }),
    ]

    expect(
      compareWithContract(collected, SCREENS, vocabulary, { ahead: true }).map(formatProblem),
    ).toEqual(printed(collected))
    expect(printed(collected).length).toBeGreaterThanOrEqual(5)
  })
  it('reports a literal declared twice at the second place, naming the first', () => {
    const collected = [
      ...agreeing(),
      source('b.tsx', { literals: [{ anchor: 'sample.page', form: 'key', line: 7 }] }),
    ]

    expect(printed(collected)).toEqual([
      'b.tsx:7: "sample.page" is declared twice; the first is at a.tsx:3',
    ])
  })
  it('reports a literal that is not in the contract', () => {
    const collected = [
      ...agreeing(),
      source('b.tsx', {
        literals: [{ anchor: 'sample.other-button', form: 'attribute', line: 2 }],
      }),
    ]

    expect(printed(collected)).toEqual([
      'b.tsx:2: "sample.other-button" is not in contract/screens; add it there or rename it',
    ])
  })
  it('reports an anchor of the contract that no source renders', () => {
    const [first] = agreeing()
    const collected = [
      { ...source('a.tsx', {}), ...first, literals: first?.literals.slice(0, 1) ?? [] },
    ]

    expect(printed(collected)).toEqual([
      'contract/screens/__root.yaml:1: anchors["sample.mode-select"]: declared in the contract, but no source renders it',
    ])
  })
  it('reports a literal named like another literal plus a suffix of the vocabulary', () => {
    const collected = [
      ...agreeing(),
      source('b.tsx', {
        literals: [{ anchor: 'sample.mode-select.option', form: 'attribute', line: 6 }],
      }),
    ]

    expect(printed(collected)).toContain(
      'b.tsx:6: "sample.mode-select.option" is "sample.mode-select" plus the suffix "option"; derive it with testIdFor()',
    )
  })
  it('reports a testIdFor() suffix that is not in the vocabulary', () => {
    const collected = [...agreeing(), source('b.tsx', { derived: [{ suffix: 'thing', line: 8 }] })]

    expect(printed(collected)).toEqual([
      'b.tsx:8: "thing" is not a derived suffix of contract/vocabulary.md',
    ])
  })
  it('reports a code that is not in the vocabulary', () => {
    const collected = [
      ...agreeing(),
      source('b.tsx', { codes: [{ code: 'note:TEXT_REQUIRED', form: 'key', line: 4 }] }),
    ]

    expect(printed(collected)).toEqual([
      'b.tsx:4: "note:TEXT_REQUIRED" is not a code of contract/vocabulary.md',
    ])
  })
  it('keeps the problems of the collector, sorted by file and line', () => {
    const collected = [
      source('c.tsx', { problems: [{ file: 'c.tsx', line: 9, message: 'built at runtime' }] }),
      ...agreeing(),
      source('b.tsx', { derived: [{ suffix: 'thing', line: 8 }] }),
    ]

    expect(printed(collected)).toEqual([
      'b.tsx:8: "thing" is not a derived suffix of contract/vocabulary.md',
      'c.tsx:9: built at runtime',
    ])
  })
  it('refuses a derived literal even when its base lists the suffix in derived', () => {
    const screens = structuredClone(SCREENS)
    const select = screens.screens[0]?.anchors['sample.mode-select']

    Object.assign(select ?? {}, { derived: ['option'] })

    const collected = [
      ...agreeing(),
      source('b.tsx', {
        literals: [{ anchor: 'sample.mode-select.option', form: 'attribute', line: 6 }],
      }),
    ]

    expect(compareWithContract(collected, screens, vocabulary).map(formatProblem)).toEqual([
      'b.tsx:6: "sample.mode-select.option" is not in contract/screens; add it there or rename it',
      'b.tsx:6: "sample.mode-select.option" is "sample.mode-select" plus the suffix "option"; derive it with testIdFor()',
    ])
  })
})
