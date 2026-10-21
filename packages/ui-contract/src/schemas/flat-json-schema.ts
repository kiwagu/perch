/**
 * The JSON Schema of a route's `params` or `search`: an object of flat primitives, each
 * optionally tied to the control that sets it (`x-perch.control`) and, per enum value,
 * to the control and the `data-value` that choose it.
 */

import { z } from '@workspace/zod'

import { anchorSchema } from '../names.schema'

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

const parameterControlSchema = z
  .strictObject({
    control: anchorSchema.optional().describe('The anchor of the control that sets the parameter.'),
    values: z
      .record(z.string(), valueControlSchema)
      .optional()
      .describe('Per enum value, the control that chooses it.'),
  })
  .describe('The controls of the page that set the parameter.')

const parameterSchema = z
  .strictObject({
    type: z
      .enum(['string', 'integer', 'number', 'boolean'])
      .describe('The primitive type of the parameter.'),
    enum: z.array(primitiveSchema).min(1).optional().describe('The values the parameter takes.'),
    default: primitiveSchema.optional().describe('The value when the URL leaves it out.'),
    description: z.string().optional().describe('What the parameter means.'),
    'x-perch': parameterControlSchema.optional(),
  })
  .describe('One flat parameter.')

export const flatJsonSchema = z
  .strictObject({
    type: z.literal('object').describe('Always "object".'),
    properties: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), parameterSchema)
      .describe('The parameters by name.'),
    required: z.array(z.string()).optional().describe('The parameters the route needs.'),
    additionalProperties: z.literal(false).describe('Always false: no other parameter.'),
  })
  .describe('A JSON Schema 2020-12 object of flat primitive parameters.')
