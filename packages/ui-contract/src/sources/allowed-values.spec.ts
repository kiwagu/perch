import { type Expression, parseSync, type TSType, Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { type AllowedValue, allowedValues, type QueryReader, valueAllows } from './allowed-values'
import { localsOf } from './locals'

/** The language a probe is written in: `tsx`, or `ts` for an assertion written `<T>value`. */
type Lang = 'ts' | 'tsx'

/**
 * What the type written after `probe:` allows for the key `type`, with the file it is written in:
 * the probe alone, or the file `around` writes around it.
 */
function allowedBy(
  type: string,
  around: (probe: string) => string = (probe) => probe,
  lang: Lang = 'tsx',
): { allowed: AllowedValue[] | undefined; text: string } {
  const text = around(`let probe: ${type}`)
  const { program } = parseSync(`x.${lang}`, text, { lang, sourceType: 'module' })
  const found: TSType[] = []

  new Visitor({
    VariableDeclarator: (node) => {
      if (node.id.type === 'Identifier' && node.id.name === 'probe' && node.id.typeAnnotation) {
        found.push(node.id.typeAnnotation.typeAnnotation)
      }
    },
  }).visit(program)

  const [probe] = found

  if (probe === undefined) {
    throw new Error('the file types its probe')
  }

  return { allowed: allowedValues(probe, 'type', localsOf(program)), text }
}

/** Each value as a string, a query as `typeof <name>`. */
const named = (allowed: AllowedValue[] | undefined): string[] | undefined =>
  allowed?.map((value) =>
    value.kind === 'literal' ? value.text : `typeof ${value.reference.name}`,
  )

/** The values a type allows, a query as `typeof <name>`. */
const valuesOf = (
  type: string,
  around?: (probe: string) => string,
  lang?: Lang,
): string[] | undefined => named(allowedBy(type, around, lang).allowed)

/**
 * The values the type of the value `probe` is declared with allows, in the file `around` writes,
 * a query of a name's key read by `read` where it is given.
 */
function writtenOf(
  value: string,
  around: (probe: string) => string = (probe) => probe,
  read?: QueryReader,
): string[] | undefined {
  const { program } = parseSync('x.tsx', around(`const probe = ${value}`), {
    lang: 'tsx',
    sourceType: 'module',
  })
  const found: Expression[] = []

  new Visitor({
    VariableDeclarator: (node) => {
      if (node.id.type === 'Identifier' && node.id.name === 'probe' && node.init) {
        found.push(node.init)
      }
    },
  }).visit(program)

  const [probe] = found

  if (probe === undefined) {
    throw new Error('the file declares its probe')
  }

  return named(valueAllows(probe, 'type', localsOf(program), 0, read))
}

/** The file that writes `lines`, then types the probe. */
const after =
  (...lines: string[]) =>
  (probe: string): string =>
    [...lines, probe].join('\n')

/** A template literal type, `a${string}`: written in parts, which no string placeholder rule reads. */
const TEMPLATE = ['`a$', '{string}`'].join('')

/** A template with an expression, `sample.${'save'}-button`: a `string`, written in parts too. */
const BUILT = ['`sample.$', "{'save'}-button`"].join('')

const SAVE = "'sample.save-button'"

const A = "'sample.a-button'"

describe('allowedValues', () => {
  it('reads a string literal type, in parentheses or not', () => {
    expect(valuesOf("'sample.a-button'")).toEqual(['sample.a-button'])
    expect(valuesOf('"sample.a-button"')).toEqual(['sample.a-button'])
    expect(valuesOf("('sample.a-button')")).toEqual(['sample.a-button'])
  })
  it('reads a query of the key of a name, where it is written', () => {
    const { allowed, text } = allowedBy('typeof reset.type')

    expect(allowed?.map((value) => value.kind)).toEqual(['query'])

    // The name is handed on as written, so the file's own reading of it (a value, or the type it is
    // annotated with) can be asked where it is.
    const [value] = allowed ?? []

    expect(value?.kind === 'query' ? [value.reference.name, value.reference.start] : []).toEqual([
      'reset',
      text.indexOf('reset'),
    ])
  })
  it('reads a union of such types, whatever it nests', () => {
    expect(valuesOf("'a' | typeof reset.type | ('b' | 'c')")).toEqual([
      'a',
      'typeof reset',
      'b',
      'c',
    ])
  })
  it('reads a query of a const of the file whose type is one string the file writes', () => {
    for (const declared of [
      [`const SAVE_TEST_ID = ${SAVE}`],
      ['const SAVE_TEST_ID = `sample.save-button`'],
      [`const SAVE_TEST_ID = (${SAVE} as const)`],
      [`const SAVE_TEST_ID = ${SAVE} satisfies string`],
      [`const SAVE_TEST_ID: ${SAVE} = ${SAVE}`],
      [`const SAVE_TEST_ID: (${SAVE}) = ${SAVE}`],
      [`const BASE_TEST_ID = ${SAVE}`, 'const SAVE_TEST_ID = BASE_TEST_ID'],
      [`const base = ${SAVE}`, 'const SAVE_TEST_ID: typeof base = base'],
      [`const save = ${SAVE}`, 'const SAVE_TEST_ID = (save)'],
    ]) {
      expect(valuesOf('typeof SAVE_TEST_ID', after(...declared)), declared.join('; ')).toEqual([
        'sample.save-button',
      ])
    }

    // An annotation is the const's type: every string it allows, which the caller holds to one event.
    expect(
      valuesOf(
        'typeof SAVE_TEST_ID',
        after(`const SAVE_TEST_ID: ${SAVE} | 'sample.a-button' = ${SAVE}`),
      ),
    ).toEqual(['sample.save-button', 'sample.a-button'])
    expect(
      valuesOf('typeof SAVE_TEST_ID', after(`const SAVE_TEST_ID: typeof reset.type = ${SAVE}`)),
    ).toEqual(['typeof reset'])
    expect(
      valuesOf("'sample.a-button' | typeof SAVE_TEST_ID", after(`const SAVE_TEST_ID = ${SAVE}`)),
    ).toEqual(['sample.a-button', 'sample.save-button'])
  })
  it('reads a query of a const whose value an assertion other than as const types by that type', () => {
    // `<value> as <T>` and `<T><value>` are typed `T`, which may allow more than the value: `T` is
    // read as an annotation, where the value reads as strings `T` allows; `as const` keeps the
    // value's own string.
    const reads: ReadonlyArray<readonly [string, readonly string[], Lang?]> = [
      [`const SAVE_TEST_ID = ${SAVE} as ${SAVE}`, ['sample.save-button']],
      [`const SAVE_TEST_ID = (${SAVE} as (${SAVE})) satisfies string`, ['sample.save-button']],
      [`const SAVE_TEST_ID = ${SAVE} as ${SAVE} | ${A}`, ['sample.save-button', 'sample.a-button']],
      [`const SAVE_TEST_ID = <${SAVE}>${SAVE}`, ['sample.save-button'], 'ts'],
      [`const SAVE_TEST_ID = <const>${SAVE}`, ['sample.save-button'], 'ts'],
      [
        `const SAVE_TEST_ID = <${SAVE} | ${A}>${SAVE}`,
        ['sample.save-button', 'sample.a-button'],
        'ts',
      ],
    ]

    for (const [declared, values, lang] of reads) {
      expect(valuesOf('typeof SAVE_TEST_ID', after(declared), lang), declared).toEqual(values)
    }

    // A type the file does not state as strings says nothing, whatever the value holds; nor does
    // one whose value does not read as strings it states: another string, a call, a query.
    const unread: ReadonlyArray<readonly [string, Lang?]> = [
      [`const SAVE_TEST_ID = ${SAVE} as Anchor`],
      [`const SAVE_TEST_ID = ${SAVE} as ${SAVE} | string`],
      [`const SAVE_TEST_ID = <string>${SAVE}`, 'ts'],
      [`const SAVE_TEST_ID = ${A} as ${SAVE}`],
      [`const SAVE_TEST_ID = testIdFor('sample', 'a-button') as ${SAVE}`],
      [`const SAVE_TEST_ID = <${SAVE}>testIdFor('sample', 'a-button')`, 'ts'],
      [`const SAVE_TEST_ID = ${SAVE} as typeof reset.type`],
    ]

    for (const [declared, lang] of unread) {
      expect(valuesOf('typeof SAVE_TEST_ID', after(declared), lang), declared).toBeUndefined()
    }
  })
  it('cannot tell a query of a name whose type the file does not state as one string', () => {
    for (const declared of [
      [],
      ["import { SAVE_TEST_ID } from './ids'"],
      [`let SAVE_TEST_ID = ${SAVE}`],
      [`var SAVE_TEST_ID = ${SAVE}`],
      [`const SAVE_TEST_ID: string = ${SAVE}`],
      [`const SAVE_TEST_ID: Anchor = ${SAVE}`],
      [`declare const SAVE_TEST_ID: ${SAVE}`],
      [`const SAVE_TEST_ID = ${SAVE} as string`],
      // `testIdFor()` is typed `string`: the const allows any event, whatever it holds at runtime.
      ["const SAVE_TEST_ID = testIdFor('sample', 'save-button')"],
      [`const SAVE_TEST_ID = ${BUILT}`],
      [`const BASE_TEST_ID: string = ${SAVE}`, 'const SAVE_TEST_ID = BASE_TEST_ID'],
      [`let BASE_TEST_ID = ${SAVE}`, 'const SAVE_TEST_ID = BASE_TEST_ID'],
      ["import { BASE_TEST_ID } from './ids'", 'const SAVE_TEST_ID = BASE_TEST_ID'],
      [`const { SAVE_TEST_ID } = { SAVE_TEST_ID: ${SAVE} } as const`],
      [`const ids = { save: ${SAVE} } as const`, 'const SAVE_TEST_ID = ids.save'],
      [`const SAVE_TEST_ID = { type: ${SAVE} } as const`],
      ['const SAVE_TEST_ID = 1'],
      ['function SAVE_TEST_ID() {}'],
      // A cycle ends unread.
      ['const SAVE_TEST_ID = BASE_TEST_ID', 'const BASE_TEST_ID = SAVE_TEST_ID'],
      ['const SAVE_TEST_ID: typeof SAVE_TEST_ID = SAVE_TEST_ID'],
    ]) {
      expect(
        valuesOf('typeof SAVE_TEST_ID', after(...declared)),
        declared.join('; ') || 'undeclared',
      ).toBeUndefined()
    }

    // The query is read where it is written: a parameter there hides the file's const.
    const shadowed = (probe: string): string =>
      [`const SAVE_TEST_ID = ${SAVE}`, `function f(SAVE_TEST_ID: string) { ${probe} }`].join('\n')

    expect(valuesOf('typeof SAVE_TEST_ID', shadowed)).toBeUndefined()
    expect(
      valuesOf('typeof SAVE_TEST_ID<string>', after(`const SAVE_TEST_ID = ${SAVE}`)),
    ).toBeUndefined()
  })
  it('cannot tell a type that allows more than those, or that the file does not state', () => {
    for (const type of [
      'string',
      "'a' | string",
      "'a' | Event",
      'Event',
      "Event<'a'>",
      'typeof reset',
      'typeof reset.other',
      'typeof outer.reset.type',
      'typeof this.type',
      "typeof import('./reset')",
      TEMPLATE,
      '1',
      'true',
      'never',
      'any',
      'unknown',
      "'a'[]",
    ]) {
      expect(valuesOf(type)).toBeUndefined()
    }
  })
})

describe('valueAllows', () => {
  it('reads an assertion to a query by the events the caller reads it as, where the value is one', () => {
    /** The caller's reading of `typeof <name>.type`: `defaults` stands for the save event. */
    const read: QueryReader = ({ reference }) =>
      reference.name === 'defaults' ? ['sample.save-button'] : undefined

    expect(writtenOf(`${SAVE} as typeof defaults.type`, undefined, read)).toEqual([
      'typeof defaults',
    ])
    expect(writtenOf(`${SAVE} as typeof defaults.type | ${A}`, undefined, read)).toEqual([
      'typeof defaults',
      'sample.a-button',
    ])

    // Another event than it stands for, a query the caller cannot read, or no reader: none.
    for (const [value, reader] of [
      [`${A} as typeof defaults.type`, read],
      [`${SAVE} as typeof other.type`, read],
      [`${SAVE} as typeof defaults.type`, undefined],
    ] as const) {
      expect(writtenOf(value, undefined, reader), value).toBeUndefined()
    }
  })
  it('reads the type of a value the file writes: its string, or the type an assertion gives it', () => {
    const reads: ReadonlyArray<readonly [string, readonly string[], string?]> = [
      [SAVE, ['sample.save-button']],
      [`${SAVE} as const`, ['sample.save-button']],
      [`(${SAVE} as const) satisfies string`, ['sample.save-button']],
      [`${SAVE} as ${SAVE}`, ['sample.save-button']],
      [`${SAVE} as ${SAVE} | ${A}`, ['sample.save-button', 'sample.a-button']],
      ['SAVE_TEST_ID', ['sample.save-button'], `const SAVE_TEST_ID = ${SAVE}`],
    ]

    for (const [value, values, declared] of reads) {
      expect(writtenOf(value, declared === undefined ? undefined : after(declared)), value).toEqual(
        values,
      )
    }
  })
  it('cannot tell the type of a value the file does not state as strings', () => {
    const unread: ReadonlyArray<readonly [string, string?]> = [
      [`${SAVE} as string`],
      [`${SAVE} as Anchor`],
      [`${A} as ${SAVE}`],
      [`${SAVE} as ${A}`],
      [`testIdFor('sample', 'a-button') as ${SAVE}`],
      [`props.event as ${SAVE}`],
      ["testIdFor('sample', 'save-button')"],
      ['SAVE_TEST_ID', `const SAVE_TEST_ID: string = ${SAVE}`],
      ['SAVE_TEST_ID', `let SAVE_TEST_ID = ${SAVE}`],
      [`{ type: ${SAVE} } as const`],
    ]

    for (const [value, declared] of unread) {
      expect(
        writtenOf(value, declared === undefined ? undefined : after(declared)),
        value,
      ).toBeUndefined()
    }
  })
})
