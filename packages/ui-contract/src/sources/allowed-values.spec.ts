import { parseSync, type TSType, Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { type AllowedValue, allowedValues } from './allowed-values'

/** What the type written after `probe:` allows for the key `type`, with the file it is written in. */
function allowedBy(type: string): { allowed: AllowedValue[] | undefined; text: string } {
  const text = `let probe: ${type}`
  const { program } = parseSync('x.tsx', text, { lang: 'tsx', sourceType: 'module' })
  const found: TSType[] = []

  new Visitor({
    VariableDeclarator: (node) => {
      if (node.id.type === 'Identifier' && node.id.typeAnnotation) {
        found.push(node.id.typeAnnotation.typeAnnotation)
      }
    },
  }).visit(program)

  const [probe] = found

  if (probe === undefined) {
    throw new Error('the file types its probe')
  }

  return { allowed: allowedValues(probe, 'type'), text }
}

/** The values a type allows, a query as `typeof <name>`. */
const valuesOf = (type: string): string[] | undefined =>
  allowedBy(type).allowed?.map((value) =>
    value.kind === 'literal' ? value.text : `typeof ${value.name}`,
  )

/** A template literal type, `a${string}`: written in parts, which no string placeholder rule reads. */
const TEMPLATE = ['`a$', '{string}`'].join('')

describe('allowedValues', () => {
  it('reads a string literal type, in parentheses or not', () => {
    expect(valuesOf("'sample.a-button'")).toEqual(['sample.a-button'])
    expect(valuesOf('"sample.a-button"')).toEqual(['sample.a-button'])
    expect(valuesOf("('sample.a-button')")).toEqual(['sample.a-button'])
  })
  it('reads a query of the key of a name, where it is written', () => {
    const { allowed, text } = allowedBy('typeof reset.type')

    expect(allowed).toEqual([{ kind: 'query', name: 'reset', at: text.indexOf('reset') }])
  })
  it('reads a union of such types, whatever it nests', () => {
    expect(valuesOf("'a' | typeof reset.type | ('b' | 'c')")).toEqual([
      'a',
      'typeof reset',
      'b',
      'c',
    ])
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
