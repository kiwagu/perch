/**
 * The JSON Schema of a route's `params` or `search`: an object of flat primitives, each
 * with the bounds `z.toJSONSchema` writes (`minimum`, `maximum`, `minLength`, `maxLength`,
 * `pattern`) and its `examples` (fake values for the route's example link; the contract
 * check holds each one to the parameter), optionally tied to the control that sets it
 * (`x-perch.control`) and, per enum value, to the control and the `data-value` that choose it.
 * A search parameter may also be the screen's key (`x-perch.key`), which a path parameter never
 * is: an action takes a value of the address as `{ search: <name> }` alone.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema } from '../names.schema'

import { DESCRIPTION_PURPOSES } from './description-purposes'

const primitiveSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .describe('A string, number or boolean value.')

const valueControlSchema = z
  .strictObject({
    control: anchorSchema.describe('The anchor of the control that chooses this value.'),
    controlValue: z
      .string()
      .optional()
      .describe('The data-value of that control which chooses this value.'),
    note: z.string().optional().describe('Anything a reader needs to know about the value.'),
  })
  .describe('How a page sets one enum value of the parameter.')

/** The keys of `x-perch` every route parameter may write: the controls that set it. */
const controlKeys = {
  control: anchorSchema.optional().describe('The anchor of the control that sets the parameter.'),
  values: z
    .record(z.string(), valueControlSchema)
    .optional()
    .describe('Per enum value, the control that chooses it.'),
}

const parameterControlSchema = z
  .strictObject(controlKeys)
  .describe('The controls of the page that set the parameter.')

const searchControlSchema = z
  .strictObject({
    ...controlKeys,
    key: codeSchema
      .optional()
      .describe(
        "Makes the parameter the screen's key: a value of it missing or broken is the failure with this code. A route has one key, and a key has no `default`. See the rule `address-key`.",
      ),
  })
  .describe("The controls of the page that set the parameter, and whether it is the screen's key.")

/**
 * The keywords of a flat parameter that say what values it takes, the one shape every schema of a
 * value is built from (a platform value, a parameter of a platform action).
 */
export const parameterKeywords = {
  type: z
    .enum(['string', 'integer', 'number', 'boolean'])
    .describe('The primitive type of the parameter.'),
  enum: z.array(primitiveSchema).min(1).optional().describe('The values the parameter takes.'),
  default: primitiveSchema.optional().describe('The value when the URL leaves it out.'),
  examples: z
    .array(primitiveSchema)
    .min(1)
    .optional()
    .describe(
      'Fake values of the parameter, each one it accepts; the first fills the example link.',
    ),
  minimum: z.number().optional().describe('The smallest value of a number or an integer.'),
  maximum: z.number().optional().describe('The largest value of a number or an integer.'),
  minLength: z.int().min(0).optional().describe('The fewest characters of a string.'),
  maxLength: z.int().min(0).optional().describe('The most characters of a string.'),
  pattern: z
    .string()
    .optional()
    .describe('A regular expression (ECMA-262) every value of a string matches.'),
}

const parameterFields = {
  ...parameterKeywords,
  description: z.string().optional().describe(DESCRIPTION_PURPOSES.parameter),
}

const parameterSchema = z
  .strictObject({ ...parameterFields, 'x-perch': parameterControlSchema.optional() })
  .describe('One flat parameter.')

const searchParameterSchema = z
  .strictObject({ ...parameterFields, 'x-perch': searchControlSchema.optional() })
  .describe('One flat parameter.')

/** A JSON Schema 2020-12 object whose parameters, by name, are each `parameter`. */
const flatObjectOf = <Parameter extends z.ZodType>(parameter: Parameter) =>
  z
    .strictObject({
      type: z.literal('object').describe('Always "object".'),
      properties: z
        .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), parameter)
        .describe('The parameters by name.'),
      required: z.array(z.string()).optional().describe('The parameters the route needs.'),
      additionalProperties: z.literal(false).describe('Always false: no other parameter.'),
    })
    .describe('A JSON Schema 2020-12 object of flat primitive parameters.')

/** A route's `params`, and any flat object of route parameters. */
export const flatJsonSchema = flatObjectOf(parameterSchema)

/** A route's `search`: its parameters may also name the screen's key. */
export const searchJsonSchema = flatObjectOf(searchParameterSchema)
