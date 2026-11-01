import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sampleContract } from '../check/contract.fixture'
import { formatProblem, type ScreensFile } from '../files'

import { type Collected, collectFromSource, RUNTIME_SUFFIX } from './collect'
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
      anchors: {
        'sample.page': { kind: 'page' },
        'sample.mode-select': { kind: 'select', derived: ['option'] },
      },
    },
  ],
  files: ['contract/domain/screens/__root.yaml'],
}

const source = (file: string, part: Partial<Omit<Collected, 'file'>>): Collected => ({
  file,
  literals: [],
  derived: [],
  codes: [],
  inputs: [],
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

/** The contract with a field that holds input and one whose own change runs its action. */
const WITH_FIELDS: ScreensFile = {
  ...SCREENS,
  screens: SCREENS.screens.map((screen) => ({
    ...screen,
    anchors: {
      ...screen.anchors,
      'sample.form.name-input': { kind: 'input', holdsInput: true },
      'sample.page.kind-select': { kind: 'select', holdsInput: false },
    },
  })),
}

/** The sources that render the two fields, with `inputs` as their holdsInput. */
const withInputs = (inputs: Collected['inputs']): Collected[] => [
  ...agreeing(),
  source('x.tsx', {
    literals: [
      { anchor: 'sample.form.name-input', form: 'attribute', line: 3 },
      { anchor: 'sample.page.kind-select', form: 'prop', line: 4 },
    ],
    inputs,
  }),
]

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
      'b.tsx:2: "sample.other-button" is not in contract/domain/screens; add it there or rename it',
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
  it("holds a field's holdsInput to the contract", () => {
    expect(
      compareWithContract(
        withInputs([
          { anchor: 'sample.form.name-input', holdsInput: false, line: 3 },
          { anchor: 'sample.page.kind-select', holdsInput: true, line: 4 },
        ]),
        WITH_FIELDS,
        vocabulary,
      ).map(formatProblem),
    ).toEqual([
      'contract/domain/screens/__root.yaml:1: anchors["sample.page.kind-select"]: does not hold input by the contract; its element carries holdsInput={false}',
      'x.tsx:3: "sample.form.name-input" holds input by the contract; drop holdsInput={false}',
      'x.tsx:4: "sample.page.kind-select": holdsInput={true} is the default; leave it out',
    ])
    expect(
      compareWithContract(
        withInputs([{ anchor: 'sample.page.kind-select', holdsInput: false, line: 4 }]),
        WITH_FIELDS,
        vocabulary,
      ),
    ).toEqual([])
  })
  it('wants the opt-out on the element of a field that holds no input, once it is rendered', () => {
    expect(compareWithContract(withInputs([]), WITH_FIELDS, vocabulary).map(formatProblem)).toEqual(
      [
        'contract/domain/screens/__root.yaml:1: anchors["sample.page.kind-select"]: does not hold input by the contract; its element carries holdsInput={false}',
      ],
    )
    // On a branch the contract may run ahead: the element gains its opt-out in the code's commit.
    expect(
      compareWithContract(withInputs([]), WITH_FIELDS, vocabulary, { ahead: true }).map(
        formatProblem,
      ),
    ).toEqual([])
  })

  it('reports holdsInput on an anchor that is not a field', () => {
    expect(
      compareWithContract(
        [
          source('a.tsx', {
            literals: [
              { anchor: 'sample.page', form: 'attribute', line: 3 },
              { anchor: 'sample.mode-select', form: 'prop', line: 4 },
            ],
            inputs: [{ anchor: 'sample.page', holdsInput: false, line: 3 }],
          }),
        ],
        SCREENS,
        vocabulary,
      ).map(formatProblem),
    ).toEqual(['a.tsx:3: "sample.page" is a page, not a field; only a field holds input'])
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
      'b.tsx:2: "sample.other-button" is not in contract/domain/screens; add it there or rename it',
    ])
  })
  it('reports an anchor of the contract that no source renders', () => {
    const [first] = agreeing()
    const collected = [
      { ...source('a.tsx', {}), ...first, literals: first?.literals.slice(0, 1) ?? [] },
    ]

    expect(printed(collected)).toEqual([
      'contract/domain/screens/__root.yaml:1: anchors["sample.mode-select"]: declared in the contract, but no source renders it',
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
  it('takes a derived part only where an anchor lists its suffix: a visibility-button on an input', () => {
    const eye = (base?: string): Collected =>
      source('eye.tsx', {
        derived: [
          { suffix: 'visibility-button', ...(base === undefined ? {} : { base }), line: 7 },
        ],
      })

    expect(printed([...agreeing(), eye()])).toEqual([
      'eye.tsx:7: "visibility-button": no anchor of contract/domain/screens lists it in its derived',
    ])

    const screens = structuredClone(WITH_FIELDS)

    Object.assign(screens.screens[0]?.anchors['sample.form.name-input'] ?? {}, {
      derived: ['visibility-button'],
    })

    const rendered = withInputs([{ anchor: 'sample.page.kind-select', holdsInput: false, line: 4 }])
    const compared = (collected: readonly Collected[]): string[] =>
      compareWithContract(collected, screens, vocabulary).map(formatProblem)

    expect(compared([...rendered, eye()])).toEqual([])
    expect(compared([...rendered, eye('sample.form.name-input')])).toEqual([])
    expect(compared([...rendered, eye('sample.page')])).toEqual([
      'eye.tsx:7: testIdFor("sample.page", "visibility-button"): "sample.page" does not list "visibility-button" in its derived',
    ])
    expect(compared([...rendered, eye('sample.gone-input')])).toEqual([
      'eye.tsx:7: testIdFor("sample.gone-input", "visibility-button"): "sample.gone-input" is not in contract/domain/screens',
    ])
  })
  it('holds a literal base, quoted, a template or wrapped, to the anchor that lists its suffix', () => {
    const screens = structuredClone(SCREENS)

    Object.assign(screens.screens[0]?.anchors ?? {}, {
      'sample.title-input': { kind: 'input', derived: ['visibility-button'] },
      'sample.leave-dialog': { kind: 'dialog', derived: ['confirm-button'] },
    })

    const file = join(import.meta.dirname, '../__fixtures__/sources/derived.tsx')
    const derived = collectFromSource(readFileSync(file, 'utf8'), 'sources/derived.tsx')

    expect(
      compareWithContract([derived], screens, vocabulary, { ahead: true }).map(formatProblem),
    ).toEqual([
      `sources/derived.tsx:9: ${RUNTIME_SUFFIX}`,
      'sources/derived.tsx:21: testIdFor("sample.gone-dialog", "confirm-button"): "sample.gone-dialog" is not in contract/domain/screens',
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
  it('takes a toast code the loader derived as a code of the contract', () => {
    const collected = [
      ...agreeing(),
      source('b.tsx', { codes: [{ code: 'thing-created', form: 'key', line: 4 }] }),
    ]

    expect(printed(collected)).toEqual([
      'b.tsx:4: "thing-created" is not a code of contract/vocabulary.md',
    ])
    expect(
      compareWithContract(
        collected,
        {
          ...SCREENS,
          toasts: [{ anchor: 'sample.page', code: 'thing-created', action: 'thing.createThing' }],
        },
        vocabulary,
      ).map(formatProblem),
    ).toEqual([])
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
      'b.tsx:6: "sample.mode-select.option" is not in contract/domain/screens; add it there or rename it',
      'b.tsx:6: "sample.mode-select.option" is "sample.mode-select" plus the suffix "option"; derive it with testIdFor()',
    ])
  })
})
