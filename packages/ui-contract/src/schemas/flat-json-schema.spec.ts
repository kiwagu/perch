import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { flatJsonSchema, searchJsonSchema } from './flat-json-schema'

/** What `z.toJSONSchema` writes for a router's search schema, without its dialect. */
const written = (schema: z.ZodType): unknown => {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { target: 'draft-2020-12' })

  return rest
}

describe('flatJsonSchema', () => {
  it('takes the bounds Zod writes for an integer, a string and a pattern', () => {
    const search = written(
      z.strictObject({
        page: z.int().min(1),
        size: z.number().max(100),
        q: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z]+$/),
      }),
    )

    expect(flatJsonSchema.safeParse(search).error?.issues).toBeUndefined()
    expect(flatJsonSchema.parse(search).properties['page']).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    })
  })
  it('refuses a length that is not a whole number of characters', () => {
    const parsed = flatJsonSchema.safeParse({
      type: 'object',
      properties: { q: { type: 'string', minLength: 1.5 } },
      additionalProperties: false,
    })

    expect(parsed.success).toBe(false)
  })
  it('refuses a format, which a value takes and a route parameter never does', () => {
    const parsed = flatJsonSchema.safeParse({
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      additionalProperties: false,
    })

    expect(parsed.success).toBe(false)
  })
  it('takes a boolean among the values of a route parameter, unlike a value of the platform', () => {
    const parsed = flatJsonSchema.safeParse({
      type: 'object',
      properties: { open: { type: 'boolean', enum: [true, false] } },
      additionalProperties: false,
    })

    expect(parsed.error?.issues).toBeUndefined()
  })
  it('takes the examples of a parameter, one value at least', () => {
    const schema = (examples: unknown[]) => ({
      type: 'object',
      properties: { key: { type: 'string', examples } },
      additionalProperties: false,
    })

    expect(
      flatJsonSchema.parse(schema(['thg_01hzx9k2', 'thg_01hzxa7q'])).properties['key'],
    ).toEqual({ type: 'string', examples: ['thg_01hzx9k2', 'thg_01hzxa7q'] })
    expect(flatJsonSchema.safeParse(schema([])).success).toBe(false)
    expect(flatJsonSchema.safeParse(schema([{ id: 1 }])).success).toBe(false)
  })
})

describe('the key of an address', () => {
  const keyed = (perch: Record<string, unknown>) => ({
    type: 'object',
    properties: { token: { type: 'string', minLength: 1, 'x-perch': perch } },
    additionalProperties: false,
  })

  it('takes a code as the key of a search parameter, beside its controls', () => {
    expect(searchJsonSchema.safeParse(keyed({ key: 'link-invalid' })).error?.issues).toBeUndefined()
    expect(
      searchJsonSchema.parse(keyed({ key: 'link-invalid', control: 'sample.token-input' }))
        .properties['token']?.['x-perch'],
    ).toEqual({ key: 'link-invalid', control: 'sample.token-input' })
  })
  it('refuses a key that is no code', () => {
    expect(searchJsonSchema.safeParse(keyed({ key: 'Link invalid' })).success).toBe(false)
  })
  it('refuses a key on a path parameter, which no action takes as `{ search }`', () => {
    expect(flatJsonSchema.safeParse(keyed({ key: 'link-invalid' })).success).toBe(false)
  })
})
