/**
 * A value: a type with its constraints, declared once where its policy lives (a name of
 * `platform.values`, or a field of the model) and referred to by name from the parameters of the
 * platform actions. Its bounds are those of a route's flat parameter (`parameterKeywords`), its
 * `enum` takes strings and numbers alone, its `examples` any list, and it may name a `format`,
 * which a route's search never takes; the value a field takes, derived, has the same keywords.
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
      'The format every value of a string keeps: `email`, an address of mail. A field that takes it is `type=email` in a form without `noValidate`, so the browser refuses a text that is no email when the form submits, before the action runs (a button that does not submit runs its action unchecked); where the action declares an `-invalid` code, it answers what passes the browser. See the rule `email-format`.',
    ),
  minimum,
  maximum,
}

export const valueSchema = z
  .strictObject({
    type: type.optional().describe('The primitive type of the value.'),
    ...valueKeywords,
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
    'The value the parameter takes: a name of `platform.values` (`email`) or a field of the model, `<entity>.<field>` (`profile.name`), whose constraints it takes; a keyword written beside it only narrows it (`maxLength: 100` beside `email`), and `contract:check` refuses one that would widen it. See the rule `declared-values`.',
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
