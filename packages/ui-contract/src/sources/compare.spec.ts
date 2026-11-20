import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sampleContract } from '../check/contract.fixture'
import { formatProblem, type ScreensFile } from '../files'

import { type Collected, collectFromSource, RUNTIME_SUFFIX, UNFOLLOWED_SPREAD } from './collect'
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
  colours: [],
  props: [],
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

/** Why a view writes none of the props the contract decides for a field, as the problems say it. */
const KIT = "the kit takes it from the contract's field facts; leave it out"

/** The problems of `collected` against `screens`, in strict mode and in ahead mode. */
const strictAndAhead = (
  collected: readonly Collected[],
  screens: ScreensFile,
  vocab: typeof vocabulary = vocabulary,
): { strict: string[]; ahead: string[] } => ({
  strict: compareWithContract(collected, screens, vocab).map(formatProblem),
  ahead: compareWithContract(collected, screens, vocab, { ahead: true }).map(formatProblem),
})

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

/** The contract with an input that shows its state colour, one that drops it, and a form. */
const WITH_COLOURS: ScreensFile = {
  ...SCREENS,
  screens: SCREENS.screens.map((screen) => ({
    ...screen,
    anchors: {
      ...screen.anchors,
      'sample.form': { kind: 'form' },
      'sample.form.name-input': { kind: 'input', holdsInput: true },
      'sample.form.code-input': { kind: 'input', holdsInput: true, marksState: false },
    },
  })),
}

/** The sources that render the form and its two inputs, with `colours` as their marksState. */
const withColours = (colours: Collected['colours']): Collected[] => [
  ...agreeing(),
  source('x.tsx', {
    literals: [
      { anchor: 'sample.form.name-input', form: 'attribute', line: 3 },
      { anchor: 'sample.form.code-input', form: 'attribute', line: 4 },
      { anchor: 'sample.form', form: 'attribute', line: 5 },
    ],
    colours,
  }),
]

/** The contract with a paged list: a list that derives the range, the two links and the size select. */
const WITH_PAGED_LIST: ScreensFile = {
  ...SCREENS,
  screens: SCREENS.screens.map((screen) => ({
    ...screen,
    anchors: {
      ...screen.anchors,
      'sample.list': {
        kind: 'list',
        derived: ['range', 'previous-link', 'next-link', 'size-select'],
      },
    },
  })),
}

/** The sources that render the paged list and derive its parts, with `flags` as the flags they carry. */
const withPagedList = (
  flags: Partial<Pick<Collected, 'inputs' | 'colours'>>,
  suffixes: readonly string[] = ['size-select'],
): Collected[] => [
  ...agreeing(),
  source('list.tsx', {
    literals: [{ anchor: 'sample.list', form: 'attribute', line: 3 }],
    derived: suffixes.map((suffix, index) => ({ suffix, base: 'sample.list', line: 5 + index })),
    ...flags,
  }),
]

/** The vocabulary with the parts a paged list derives. */
const PAGED_VOCABULARY = {
  ...vocabulary,
  suffixes: {
    ...vocabulary.suffixes,
    ...Object.fromEntries(
      ['range', 'previous-link', 'next-link', 'size-select'].map((suffix) => [
        suffix,
        `the ${suffix}`,
      ]),
    ),
  },
}

const pagedProblems = (
  collected: readonly Collected[],
  screens: ScreensFile = WITH_PAGED_LIST,
): string[] => compareWithContract(collected, screens, PAGED_VOCABULARY).map(formatProblem)

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
  it('reports an anchor an object writes under a computed key a const holds, in ahead mode too', () => {
    const view = (override: string): Collected[] => [
      collectFromSource(
        [
          "const TEST_ID_PROP = 'data-testid'",
          `const a = <Page data-testid="sample.page" {...(compact ? ${override} : {})} />`,
          'const b = <Select testId="sample.mode-select" />',
        ].join('\n'),
        'x.tsx',
      ),
    ]
    const typo = strictAndAhead(view("{ [TEST_ID_PROP]: 'sample.seach-input' }"), SCREENS)
    const plain = strictAndAhead(view("{ [TEST_ID_PROP]: 'sample.mode-select' }"), SCREENS)
    const reported =
      'x.tsx:2: "sample.seach-input" is not in contract/domain/screens; add it there or rename it'

    expect(typo.strict).toContain(reported)
    expect(typo.ahead).toContain(reported)
    expect(plain.strict).not.toContain(reported)
    expect(plain.ahead).not.toContain(reported)
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
  it('refuses a holdsInput a view writes on a declared field, true or false, in ahead mode too', () => {
    // The contract says `name-input` holds input and `kind-select` holds none: neither is written.
    const found = strictAndAhead(
      withInputs([
        { anchor: 'sample.form.name-input', holdsInput: false, line: 3 },
        { anchor: 'sample.page.kind-select', holdsInput: true, line: 4 },
      ]),
      WITH_FIELDS,
    )
    const expected = [
      `x.tsx:3: "sample.form.name-input": holdsInput={false}, but ${KIT}`,
      `x.tsx:4: "sample.page.kind-select": holdsInput={true}, but ${KIT}`,
    ]

    expect(found.strict).toEqual(expected)
    expect(found.ahead).toEqual(expected)
  })
  it('refuses a holdsInput and a marksState a view writes as a name or a member, in ahead mode too', () => {
    const inputs = strictAndAhead(
      withInputs([
        { anchor: 'sample.form.name-input', holdsInput: 'localFlag', line: 3 },
        { anchor: 'sample.page.kind-select', holdsInput: 'props.hold', line: 4 },
      ]),
      WITH_FIELDS,
    )
    const colours = strictAndAhead(
      withColours([
        { anchor: 'sample.form.name-input', marksState: 'props.mark', line: 3 },
        { anchor: 'sample.form.code-input', marksState: 'mark', line: 4 },
      ]),
      WITH_COLOURS,
    )

    for (const found of [inputs.strict, inputs.ahead]) {
      expect(found).toEqual([
        `x.tsx:3: "sample.form.name-input": holdsInput={localFlag}, but ${KIT}`,
        `x.tsx:4: "sample.page.kind-select": holdsInput={props.hold}, but ${KIT}`,
      ])
    }

    for (const found of [colours.strict, colours.ahead]) {
      expect(found).toEqual([
        `x.tsx:3: "sample.form.name-input": marksState={props.mark}, but ${KIT}`,
        `x.tsx:4: "sample.form.code-input": marksState={mark}, but ${KIT}`,
      ])
    }
  })
  it('refuses the flags of a field written from a source as a name or a member, and lets a wrapper through', () => {
    const rendered = (flags: string): Collected[] => [
      ...agreeing(),
      collectFromSource(
        [
          '<form data-testid="sample.form">',
          `<Input data-testid="sample.form.name-input" ${flags} />`,
          '<Input data-testid="sample.form.code-input" />',
          '<Input data-testid={testId} holdsInput={holdsInput} marksState={props.marksState} />',
          '</form>',
        ].join('\n'),
        'x.tsx',
      ),
    ]
    const found = strictAndAhead(
      rendered('holdsInput={localFlag} marksState={props.mark}'),
      WITH_COLOURS,
    )
    const expected = [
      `x.tsx:2: "sample.form.name-input": holdsInput={localFlag}, but ${KIT}`,
      `x.tsx:2: "sample.form.name-input": marksState={props.mark}, but ${KIT}`,
    ]

    expect(found.strict).toEqual(expected)
    expect(found.ahead).toEqual(expected)
    expect(strictAndAhead(rendered(''), WITH_COLOURS)).toEqual({ strict: [], ahead: [] })
  })
  it('wants no holdsInput on the element of a field that holds no input, rendered or not', () => {
    const found = strictAndAhead(withInputs([]), WITH_FIELDS)

    expect(found.strict).toEqual([])
    expect(found.ahead).toEqual([])
  })
  it('refuses a marksState a view writes on a field that shows its state colour or drops it, in ahead mode too', () => {
    // The contract says `name-input` shows its colour and `code-input` drops it: neither is written.
    const found = strictAndAhead(
      withColours([
        { anchor: 'sample.form.name-input', marksState: false, line: 3 },
        { anchor: 'sample.form.code-input', marksState: true, line: 4 },
        { anchor: 'sample.form.code-input', marksState: false, line: 6 },
        { anchor: 'sample.form', marksState: false, line: 5 },
      ]),
      WITH_COLOURS,
    )
    const expected = [
      `x.tsx:3: "sample.form.name-input": marksState={false}, but ${KIT}`,
      `x.tsx:4: "sample.form.code-input": marksState={true}, but ${KIT}`,
      'x.tsx:5: "sample.form" is a form, not a field that holds input; only such a field shows a state colour',
      `x.tsx:6: "sample.form.code-input": marksState={false}, but ${KIT}`,
    ]

    expect(found.strict).toEqual(expected)
    expect(found.ahead).toEqual(expected)
  })
  it('wants no marksState on the element of a field that drops its state colour, rendered or not', () => {
    const found = strictAndAhead(withColours([]), WITH_COLOURS)

    expect(found.strict).toEqual([])
    expect(found.ahead).toEqual([])
  })
  it('reports marksState on a field that holds no input, and on a kind the kit does not colour', () => {
    const screens = structuredClone(WITH_COLOURS)

    Object.assign(screens.screens[0]?.anchors ?? {}, {
      'sample.page.kind-select': { kind: 'select', holdsInput: false },
      'sample.form.agree-checkbox': { kind: 'checkbox', holdsInput: true },
    })

    const rendered = (anchor: string, line: number): Collected['literals'][number] => ({
      anchor,
      form: 'attribute',
      line,
    })

    expect(
      compareWithContract(
        [
          ...withColours([]),
          source('y.tsx', {
            literals: [
              rendered('sample.page.kind-select', 3),
              rendered('sample.form.agree-checkbox', 4),
            ],
            colours: [
              { anchor: 'sample.page.kind-select', marksState: false, line: 3 },
              { anchor: 'sample.form.agree-checkbox', marksState: false, line: 4 },
            ],
          }),
        ],
        screens,
        vocabulary,
      ).map(formatProblem),
    ).toEqual([
      'y.tsx:3: "sample.page.kind-select" is a select, not a field that holds input; only such a field shows a state colour',
      'y.tsx:4: "sample.form.agree-checkbox" is a checkbox, not a field that holds input; only such a field shows a state colour',
    ])
  })
  it('refuses the limit and the type of a text field written on its element, in ahead mode too', () => {
    const screens: ScreensFile = {
      ...SCREENS,
      screens: SCREENS.screens.map((screen) => ({
        ...screen,
        anchors: {
          ...screen.anchors,
          'sample.title-input': { kind: 'input', binding: { model: 'thing.title' } },
        },
      })),
    }
    const rendering = (element: string): Collected[] => [
      ...agreeing(),
      collectFromSource(`const title = ${element}`, 'x.tsx'),
    ]

    // The element as the kit wants it: no limit and no type, whatever the contract's value says.
    expect(
      strictAndAhead(rendering('<Input data-testid="sample.title-input" />'), screens),
    ).toEqual({
      strict: [],
      ahead: [],
    })

    const written = strictAndAhead(
      rendering('<Input data-testid="sample.title-input" maxLength={80} type="email" />'),
      screens,
    )
    const expected = [
      `x.tsx:1: "sample.title-input": maxLength={80}, but ${KIT}`,
      `x.tsx:1: "sample.title-input": type="email", but ${KIT}`,
    ]

    expect(written.strict).toEqual(expected)
    expect(written.ahead).toEqual(expected)
  })
  /** The contract with a text field the view renders. */
  const withTitleInput = (): ScreensFile => ({
    ...SCREENS,
    screens: SCREENS.screens.map((screen) => ({
      ...screen,
      anchors: {
        ...screen.anchors,
        'sample.title-input': { kind: 'input', binding: { model: 'thing.title' } },
      },
    })),
  })

  it('holds an element whose anchor an async helper or a generator supplies to its field facts, and refuses the spread, in ahead mode too', () => {
    const screens = withTitleInput()
    const anchor = "{ 'data-testid': 'sample.title-input' }"
    const refused = [
      `x.tsx:2: ${UNFOLLOWED_SPREAD('sample.title-input')}`,
      `x.tsx:2: "sample.title-input": maxLength={80}, but ${KIT}`,
    ]

    // The helper is the sole source of the anchor: a Promise and an iterator are no object, yet
    // the anchor it writes is read, so the limit the view adds beside the spread is still refused.
    for (const helper of [
      `const searchProps = async () => (${anchor})`,
      `async function searchProps() { return ${anchor} }`,
      `function* searchProps() { return ${anchor} }`,
    ]) {
      const found = strictAndAhead(
        [
          ...agreeing(),
          collectFromSource(
            `${helper}\nconst title = <Input {...searchProps()} maxLength={80} />`,
            'x.tsx',
          ),
        ],
        screens,
      )

      expect(found.strict).toEqual(refused)
      expect(found.ahead).toEqual(refused)
    }
  })
  it('holds the element to its field facts when another branch of the spread is an async helper or a generator that gives no object', () => {
    const screens = withTitleInput()
    const refused = [
      `x.tsx:3: ${UNFOLLOWED_SPREAD('sample.title-input')}`,
      `x.tsx:3: "sample.title-input": maxLength={80}, but ${KIT}`,
    ]

    // What such a call gives is a Promise or an iterator, never nothing: the branch that writes
    // the anchor still decides it, whatever the helper falls through to or returns instead.
    for (const fallback of [
      'async function fallbackProps() { await loadSuggestions() }',
      'async function fallbackProps() { return }',
      'async function fallbackProps() { if (ready) { return null } await loadSuggestions() }',
      'const fallbackProps = async () => undefined',
      'function* fallbackProps() { yield 1 }',
    ]) {
      const found = strictAndAhead(
        [
          ...agreeing(),
          collectFromSource(
            [
              "const searchProps = { 'data-testid': 'sample.title-input' }",
              fallback,
              'const title = <Input {...(showSearchAnchor ? searchProps : fallbackProps())} maxLength={80} />',
            ].join('\n'),
            'x.tsx',
          ),
        ],
        screens,
      )

      expect(found.strict).toEqual(refused)
      expect(found.ahead).toEqual(refused)
    }
  })
  it('holds the element to its field facts when a spread the file cannot follow comes after the member in a props map', () => {
    const screens = withTitleInput()
    const refused = [
      `x.tsx:4: ${UNFOLLOWED_SPREAD('sample.title-input')}`,
      `x.tsx:4: "sample.title-input": maxLength={80}, but ${KIT}`,
    ]

    // The later spread may supply `search` or not: the property before it stays one more
    // alternative, so the anchor it writes is read and the limit beside the spread is refused.
    for (const rest of ['fallbackProps()', 'props.extra']) {
      const found = strictAndAhead(
        [
          ...agreeing(),
          collectFromSource(
            [
              'async function fallbackProps() { await loadSuggestions() }',
              'function Search(props) {',
              `  const fieldProps = { search: { 'data-testid': 'sample.title-input' }, ...${rest} }`,
              '  return <Input {...fieldProps.search} maxLength={80} />',
              '}',
            ].join('\n'),
            'x.tsx',
          ),
        ],
        screens,
      )

      expect(found.strict).toEqual(refused)
      expect(found.ahead).toEqual(refused)
    }
  })
  it('holds the element to its field facts when the member on the left of ?? or || may be absent, in ahead mode too', () => {
    const screens = withTitleInput()
    const refused = [
      `x.tsx:10: ${UNFOLLOWED_SPREAD('sample.title-input')}`,
      `x.tsx:10: "sample.title-input": maxLength={80}, but ${KIT}`,
    ]

    // An absent `search` selects the fallback at runtime, which writes the anchor: no branch
    // supplies nothing, so the element carries the anchor and the limit beside the spread is refused.
    for (const operator of ['??', '||']) {
      const found = strictAndAhead(
        [
          ...agreeing(),
          collectFromSource(
            [
              "const searchProps = { 'data-testid': 'sample.title-input' }",
              'async function loadFieldOverrides() {',
              '  await loadSuggestions()',
              '  return { search: searchProps }',
              '}',
              'const fieldProps: { label: string; search?: typeof searchProps } = {',
              "  label: 'Search',",
              '  ...loadFieldOverrides(),',
              '}',
              `const title = <Input {...(fieldProps.search ${operator} searchProps)} maxLength={80} />`,
            ].join('\n'),
            'x.tsx',
          ),
        ],
        screens,
      )

      expect(found.strict).toEqual(refused)
      expect(found.ahead).toEqual(refused)
    }
  })
  it('holds the element a for…of renders to the anchor each element of its array supplies, in ahead mode too', () => {
    const found = strictAndAhead(
      [
        ...agreeing(),
        collectFromSource(
          [
            "const TITLE_TEST_ID = 'sample.title-input'",
            "const inputProps = { 'data-testid': TITLE_TEST_ID }",
            'const fields = [inputProps]',
            'const inputs = []',
            'for (const inputProps of fields) {',
            "  inputs.push(<Input key={inputProps['data-testid']} {...inputProps} maxLength={3} />)",
            '}',
          ].join('\n'),
          'x.tsx',
        ),
      ],
      withTitleInput(),
    )
    const refused = [`x.tsx:6: "sample.title-input": maxLength={3}, but ${KIT}`]

    expect(found.strict).toEqual(refused)
    expect(found.ahead).toEqual(refused)
  })
  it('holds an element to the anchor a value under a key the file does not state reads as, and refuses the spreads, in ahead mode too', () => {
    const found = strictAndAhead(
      [
        ...agreeing(),
        collectFromSource(
          [
            "const TITLE_TEST_ID = 'sample.title-input'",
            "let prop: string = 'data-testid'",
            'const anchorProps = { [prop]: TITLE_TEST_ID }',
            "prop = 'aria-label'",
            "const labelProps = { [prop]: t('sample.title') }",
            'const title = <Input {...anchorProps} {...labelProps} maxLength={3} />',
          ].join('\n'),
          'x.tsx',
        ),
      ],
      withTitleInput(),
    )
    const refused = [
      `x.tsx:6: ${UNFOLLOWED_SPREAD('sample.title-input')}`,
      `x.tsx:6: ${UNFOLLOWED_SPREAD('sample.title-input')}`,
      `x.tsx:6: "sample.title-input": maxLength={3}, but ${KIT}`,
    ]

    expect(found.strict).toEqual(refused)
    expect(found.ahead).toEqual(refused)
  })

  it("refuses a holdsInput a view writes on a paged list's size select, which the field facts carry, in ahead mode too", () => {
    for (const holdsInput of [false, true]) {
      const found = strictAndAhead(
        withPagedList({
          inputs: [{ anchor: 'sample.list.size-select', base: 'sample.list', holdsInput, line: 5 }],
        }),
        WITH_PAGED_LIST,
        PAGED_VOCABULARY,
      )
      const expected = [
        `list.tsx:5: "sample.list.size-select": holdsInput={${holdsInput}}, but ${KIT}`,
      ]

      expect(found.strict).toEqual(expected)
      expect(found.ahead).toEqual(expected)
    }
  })
  it("wants no holdsInput on a paged list's size select rendered without one, in strict mode too", () => {
    const found = strictAndAhead(withPagedList({}), WITH_PAGED_LIST, PAGED_VOCABULARY)

    expect(found.strict).toEqual([])
    expect(found.ahead).toEqual([])
  })
  it("reports marksState on a paged list's size select, a select that holds no input", () => {
    expect(
      pagedProblems(
        withPagedList({
          colours: [
            { anchor: 'sample.list.size-select', base: 'sample.list', marksState: false, line: 5 },
          ],
        }),
      ),
    ).toEqual([
      'list.tsx:5: "sample.list.size-select" is a select, not a field that holds input; only such a field shows a state colour',
    ])
  })
  it('leaves an undeclared base to the parts check, with holdsInput={false} on its size select', () => {
    expect(
      pagedProblems([
        ...agreeing(),
        source('list.tsx', {
          literals: [{ anchor: 'sample.list', form: 'attribute', line: 3 }],
          derived: [{ suffix: 'size-select', base: 'missing.list', line: 5 }],
          inputs: [
            {
              anchor: 'missing.list.size-select',
              base: 'missing.list',
              holdsInput: false,
              line: 5,
            },
          ],
        }),
      ]),
    ).toEqual([
      'list.tsx:5: testIdFor("missing.list", "size-select"): "missing.list" is not in contract/domain/screens',
    ])
  })
  it('leaves an undeclared base to the parts check, with marksState={false} on its size select', () => {
    expect(
      pagedProblems([
        ...agreeing(),
        source('list.tsx', {
          literals: [{ anchor: 'sample.list', form: 'attribute', line: 3 }],
          derived: [{ suffix: 'size-select', base: 'missing.list', line: 5 }],
          colours: [
            {
              anchor: 'missing.list.size-select',
              base: 'missing.list',
              marksState: false,
              line: 5,
            },
          ],
        }),
      ]),
    ).toEqual([
      'list.tsx:5: testIdFor("missing.list", "size-select"): "missing.list" is not in contract/domain/screens',
    ])
  })
  it('reports a flag on a derived part that is not a size select: it is no field', () => {
    expect(
      pagedProblems(
        withPagedList(
          {
            inputs: [
              {
                anchor: 'sample.list.size-select',
                base: 'sample.list',
                holdsInput: false,
                line: 5,
              },
              { anchor: 'sample.list.next-link', base: 'sample.list', holdsInput: false, line: 6 },
              { anchor: 'sample.list.range', base: 'sample.list', holdsInput: true, line: 7 },
            ],
            colours: [
              { anchor: 'sample.list.next-link', base: 'sample.list', marksState: false, line: 6 },
            ],
          },
          ['size-select', 'next-link', 'range'],
        ),
      ),
    ).toEqual([
      `list.tsx:5: "sample.list.size-select": holdsInput={false}, but ${KIT}`,
      'list.tsx:6: "sample.list.next-link" is derived from "sample.list", not a field; only a field holds input',
      'list.tsx:6: "sample.list.next-link" is derived from "sample.list", not a field that holds input; only such a field shows a state colour',
      'list.tsx:7: "sample.list.range" is derived from "sample.list", not a field; only a field holds input',
    ])
  })
  it('reports a flag on a size select of a list that is not paged', () => {
    expect(
      pagedProblems(
        [
          ...agreeing(),
          source('select.tsx', {
            derived: [{ suffix: 'size-select', base: 'sample.mode-select', line: 5 }],
            inputs: [
              {
                anchor: 'sample.mode-select.size-select',
                base: 'sample.mode-select',
                holdsInput: false,
                line: 5,
              },
            ],
          }),
        ],
        SCREENS,
      ),
    ).toEqual([
      'select.tsx:5: testIdFor("sample.mode-select", "size-select"): "sample.mode-select" does not list "size-select" in its derived',
      'select.tsx:5: "sample.mode-select.size-select" is derived from "sample.mode-select", not a field; only a field holds input',
    ])
  })
  it("wants no opt-out on a paged list's next link rendered without a flag", () => {
    expect(
      pagedProblems([
        ...agreeing(),
        source('list.tsx', {
          literals: [{ anchor: 'sample.list', form: 'attribute', line: 3 }],
          derived: [{ suffix: 'next-link', base: 'sample.list', line: 6 }],
        }),
      ]),
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

    const rendered = withInputs([])
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
