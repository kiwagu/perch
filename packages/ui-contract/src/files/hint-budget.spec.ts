import { describe, expect, it } from 'vitest'

import { DESCRIPTION_BUDGET } from '../schemas'

import { hintBudgetProblems } from './hint-budget'
import { SCREEN_SCHEMA_FILE } from './paths'
import { SCHEMA_OUTPUTS } from './schema-outputs'

/** One schema the engine would write, under the screen schema's file. */
const outputOf = (schema: object) => [{ file: SCREEN_SCHEMA_FILE, schema: () => schema }]

const text = (length: number): string => 'a'.repeat(length)

describe('hintBudgetProblems', () => {
  it('refuses a field hint past the budget, naming its file, its key and its length', () => {
    const schema = {
      type: 'object',
      properties: {
        anchors: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: { binding: { type: 'string', description: text(DESCRIPTION_BUDGET + 1) } },
          },
        },
      },
    }

    const problems = hintBudgetProblems(outputOf(schema))

    expect(problems).toHaveLength(1)
    expect(problems[0]?.file).toBe(SCREEN_SCHEMA_FILE)
    expect(problems[0]?.message).toContain('anchors.<name>.binding')
    expect(problems[0]?.message).toContain(`${DESCRIPTION_BUDGET + 1} characters`)
    expect(problems[0]?.message).toContain(`budget of ${DESCRIPTION_BUDGET}`)
  })
  it('accepts a hint of exactly the budget', () => {
    const schema = { type: 'string', description: text(DESCRIPTION_BUDGET) }

    expect(hintBudgetProblems(outputOf(schema))).toEqual([])
  })
  it("reads the root's own hint too", () => {
    const schema = { type: 'object', description: text(DESCRIPTION_BUDGET + 1), properties: {} }

    expect(hintBudgetProblems(outputOf(schema))).toHaveLength(1)
  })
  it('reads a property named `description` as a key, never as a hint', () => {
    const schema = {
      type: 'object',
      properties: { description: { type: 'string', description: 'What the element is for.' } },
    }

    expect(hintBudgetProblems(outputOf(schema))).toEqual([])
  })
  it('leaves the values a schema holds as data unread', () => {
    const schema = {
      type: 'object',
      default: { description: text(DESCRIPTION_BUDGET + 1) },
      examples: [{ description: text(DESCRIPTION_BUDGET + 1) }],
      const: { description: text(DESCRIPTION_BUDGET + 1) },
      enum: [{ description: text(DESCRIPTION_BUDGET + 1) }],
    }

    expect(hintBudgetProblems(outputOf(schema))).toEqual([])
  })
  it('reads the hints of record keys, branches and definitions', () => {
    const long = { type: 'string', description: text(DESCRIPTION_BUDGET + 1) }
    const schema = {
      type: 'object',
      propertyNames: { ...long, description: text(DESCRIPTION_BUDGET + 2) },
      allOf: [{ ...long, description: text(DESCRIPTION_BUDGET + 3) }],
      $defs: { part: { ...long, description: text(DESCRIPTION_BUDGET + 4) } },
    }

    expect(hintBudgetProblems(outputOf(schema))).toHaveLength(3)
  })
  it('reads no description inside metadata an extension keyword carries', () => {
    const schema = {
      type: 'string',
      description: 'What the key is for.',
      'x-perch-context': { description: text(DESCRIPTION_BUDGET + 1) },
    }

    expect(hintBudgetProblems(outputOf(schema))).toEqual([])
  })
  it('names a shared definition by the key that first refers to it, as the reference does', () => {
    const schema = {
      type: 'object',
      properties: { flow: { $ref: '#/$defs/effect' }, other: { $ref: '#/$defs/effect' } },
      $defs: {
        effect: {
          type: 'object',
          properties: { type: { type: 'string', description: text(DESCRIPTION_BUDGET + 1) } },
        },
        orphan: { type: 'string', description: text(DESCRIPTION_BUDGET + 2) },
      },
    }

    const messages = hintBudgetProblems(outputOf(schema)).map(({ message }) => message)

    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatch(/^flow\.type: /)
    expect(messages[1]).toMatch(/^\$defs\.orphan: /)
  })
  it('gives one problem for a long hint repeated at several keys of one file', () => {
    const long = { type: 'string', description: text(DESCRIPTION_BUDGET + 1) }
    const schema = { type: 'object', properties: { a: long, b: long, c: { items: long } } }

    const problems = hintBudgetProblems(outputOf(schema))

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toContain('and 2 more keys')
  })
  it('finds no hint past the budget in the schemas the engine writes', () => {
    expect(hintBudgetProblems(SCHEMA_OUTPUTS)).toEqual([])
  })
})
