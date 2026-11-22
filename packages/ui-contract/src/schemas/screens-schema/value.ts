/**
 * A value: a type with its constraints, declared once where its policy lives (a name of
 * `platform.values`, or a field of the model) and referred to by name from the parameters of the
 * platform actions. Its bounds are those of a route's flat parameter (`parameterKeywords`), its
 * `enum` takes strings and numbers alone, its `examples` any list, and it may name a `format`,
 * which a route's search never takes; a value of `platform.values` may write `maxLength: null`,
 * no limit, so it takes no default length; the value a field takes, derived, has the same
 * keywords, its `maxLength` a number or none.
 */

import { z } from '@workspace/zod'

import { DESCRIPTION_PURPOSES } from '../description-purposes'
import { parameterKeywords } from '../flat-json-schema'

const { type, minLength, maxLength, pattern, minimum, maximum } = parameterKeywords

/** The formats a value may name. */
export const VALUE_FORMATS = ['email'] as const

/** The keywords that bound a value, shared by a value, a parameter and a field's derived value. */
export const valueKeywords = {
  enum: z
    .array(z.union([z.string(), z.number()]).describe('A string or a number.'))
    .min(1)
    .optional()
    .describe('The values it takes, each a string or a number.'),
  minLength,
  maxLength,
  pattern,
  format: z
    .enum(VALUE_FORMATS)
    .optional()
    .describe(
      "A string value's format: `email`. Its editable field is `type=email` in a form without `noValidate`; an action run without submitting skips the browser's check. See the rule `email-format`.",
    ),
  minimum,
  maximum,
}

export const valueSchema = z
  .strictObject({
    type: type.optional().describe('The primitive type of the value.'),
    ...valueKeywords,
    maxLength: z
      .int()
      .min(0)
      .nullable()
      .optional()
      .describe(
        'The most characters of a string; from version 6 a string value that writes none, no `enum`, takes `defaults.maxLength`, and `null` takes no limit. See the rule `declared-values`.',
      ),
    description: z.string().describe(DESCRIPTION_PURPOSES.value),
    examples: z
      .array(z.unknown())
      .optional()
      .describe('Fake values the value accepts, for a test or an example to use: any list.'),
  })
  .describe(
    'A value declared once: its type and its constraints, which every parameter that refers to it by name takes. See the rule `declared-values`.',
  )

export const valueRefSchema = z
  .string()
  .regex(/^([a-z][a-z0-9-]*|[a-z_]+\.[a-z_]+)$/)
  .describe(
    'The value the parameter takes: a name of `platform.values` or a model field, `<entity>.<field>`, with its constraints; a keyword beside it may narrow them, never widen. See the rule `declared-values`.',
  )

export const resolvedValueSchema = z
  .strictObject({
    type: z
      .string()
      .optional()
      .describe('The type of the value: `string`, `integer`, `number`, `boolean`.'),
    ...valueKeywords,
    readOnly: z
      .literal(true)
      .optional()
      .describe('The value is a field of the model that is read-only (`x-perch.readonly`).'),
  })
  .describe('A value as the engine resolves it: its type and constraints, its description aside.')
