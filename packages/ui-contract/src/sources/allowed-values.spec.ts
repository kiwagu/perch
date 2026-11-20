import { parseSync, type TSType, Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { type AllowedValue, allowedValues } from './allowed-values'
import { localsOf } from './locals'

/**
 * What the type written after `probe:` allows for the key `type`, with the file it is written in:
 * the probe alone, or the file `around` writes around it.
 */
function allowedBy(
  type: string,
  around: (probe: string) => string = (probe) => probe,
): { allowed: AllowedValue[] | undefined; text: string } {
  const text = around(`let probe: ${type}`)
  const { program } = parseSync('x.tsx', text, { lang: 'tsx', sourceType: 'module' })
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

/** The values a type allows, a query as `typeof <name>`. */
const valuesOf = (type: string, around?: (probe: string) => string): string[] | undefined =>
  allowedBy(type, around).allowed?.map((value) =>
    value.kind === 'literal' ? value.text : `typeof ${value.reference.name}`,
  )

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
