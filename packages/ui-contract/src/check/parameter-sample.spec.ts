import { describe, expect, it } from 'vitest'

import { flatJsonSchema } from '../schemas'

import { parameterSample } from './parameter-sample'

/** A parameter as the flat schema reads it. */
const parameter = (schema: Readonly<Record<string, unknown>>) => {
  const { properties } = flatJsonSchema.parse({
    type: 'object',
    properties: { p: schema },
    additionalProperties: false,
  })
  const read = properties['p']

  if (read === undefined) {
    throw new Error('no parameter')
  }

  return read
}

const sampleOf = (schema: Readonly<Record<string, unknown>>, slot: 'path' | 'search' = 'search') =>
  parameterSample(parameter(schema), slot)

describe('parameterSample', () => {
  it('takes the first example, then the default, then the first enum value', () => {
    expect(sampleOf({ type: 'string', examples: ['b'], default: 'a', enum: ['a', 'b'] })).toBe('b')
    expect(sampleOf({ type: 'string', default: 'b', enum: ['a', 'b'] })).toBe('b')
    expect(sampleOf({ type: 'string', enum: ['a', 'b'] })).toBe('a')
  })
  it('passes over an example its schema refuses', () => {
    expect(sampleOf({ type: 'string', pattern: '^thg_', examples: ['key'] })).toBe('thg_')
  })
  it('builds a string within its lengths, a literal pattern or one class repeated', () => {
    expect(sampleOf({ type: 'string' })).toBe('a')
    expect(sampleOf({ type: 'string', minLength: 3 })).toBe('aaa')
    expect(sampleOf({ type: 'string', minLength: 0 })).toBe('')
    expect(sampleOf({ type: 'string', pattern: '^draft$' })).toBe('draft')
    expect(sampleOf({ type: 'string', pattern: '^[a-z]+$' })).toBe('a')
    expect(sampleOf({ type: 'string', pattern: '^\\d{3}$' })).toBe('000')
    expect(sampleOf({ type: 'string', pattern: '^\\w{2,}$', minLength: 4 })).toBe('aaaa')
  })
  it('builds a pattern-prefixed id: the prefix, then its class to the length it needs', () => {
    expect(sampleOf({ type: 'string', pattern: '^thg_[a-z0-9]+$' })).toBe('thg_a')
    expect(sampleOf({ type: 'string', pattern: '^thg_[0-9a-z]{8}$' })).toBe('thg_00000000')
    expect(sampleOf({ type: 'string', pattern: '^thg_[a-z0-9]*$', minLength: 6 })).toBe('thg_aa')
  })
  it('builds a number within its bounds, whole for an integer, and a boolean', () => {
    expect(sampleOf({ type: 'integer' })).toBe(0)
    expect(sampleOf({ type: 'integer', minimum: 5, maximum: 9 })).toBe(5)
    expect(sampleOf({ type: 'integer', minimum: 1.5 })).toBe(2)
    expect(sampleOf({ type: 'number', maximum: -2.5 })).toBe(-2.5)
    expect(sampleOf({ type: 'boolean' })).toBe(true)
  })
  it('never samples an empty value for a path segment', () => {
    expect(sampleOf({ type: 'string', minLength: 0 }, 'path')).toBe('a')
    expect(sampleOf({ type: 'string', minLength: 0, pattern: '^[a-z]*$' }, 'path')).toBe('a')
    expect(sampleOf({ type: 'string', minLength: 0, pattern: '^[a-z]*$' })).toBe('')
    expect(sampleOf({ type: 'string', minLength: 0, examples: [''] }, 'path')).toBe('a')
    expect(sampleOf({ type: 'string', maxLength: 0 }, 'path')).toBeUndefined()
    expect(sampleOf({ type: 'string', enum: [''] }, 'path')).toBeUndefined()
    expect(sampleOf({ type: 'string', enum: [''] })).toBe('')
  })
  it('has none for a pattern it cannot derive, bounds nothing meets or a schema that does not compile', () => {
    expect(sampleOf({ type: 'string', pattern: '^[a-z]+-\\d+$' })).toBeUndefined()
    expect(sampleOf({ type: 'string', pattern: '^[^a]+$' })).toBeUndefined()
    expect(sampleOf({ type: 'string', pattern: '^thg_[a-z]+$', maxLength: 3 })).toBeUndefined()
    expect(sampleOf({ type: 'integer', minimum: 3, maximum: 2 })).toBeUndefined()
    expect(sampleOf({ type: 'string', pattern: '[' })).toBeUndefined()
  })
})
