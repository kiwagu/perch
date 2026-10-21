import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { flatJsonSchema } from './flat-json-schema'

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
})
