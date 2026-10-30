/** What an action receives: per parameter, the anchor whose value it takes or a constant. */

import { z } from '@workspace/zod'

import { anchorSchema } from '../../names.schema'

export const paramValueSchema = z
  .union([
    anchorSchema.describe('The anchor of the control whose value the parameter takes.'),
    z
      .strictObject({
        value: z
          .union([z.string(), z.number(), z.boolean()])
          .describe('The constant: a string, a number or a boolean.'),
      })
      .describe('A constant the parameter always takes: `{ "value": true }`.'),
  ])
  .describe('An anchor (the control whose value it takes) or a constant `{ "value": ... }`.')

export const actionParamsSchema = z
  .record(z.string(), paramValueSchema)
  .describe('Per parameter of the action, the anchor whose value it takes or a constant.')
