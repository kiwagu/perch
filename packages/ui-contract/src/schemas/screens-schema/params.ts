/**
 * What an action receives: per parameter, the anchor whose value it takes, a constant, or a
 * search parameter of the route the screen was opened at.
 */

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
    z
      .strictObject({
        search: z
          .string()
          .regex(/^[a-z][a-zA-Z0-9]*$/)
          .describe('The name of a search parameter every route of the screen declares.'),
      })
      .describe(
        'The value of a search parameter of the route the screen was opened at: `{ "search": "token" }`, the token a link carries.',
      ),
  ])
  .describe(
    'An anchor (the control whose value it takes), a constant `{ "value": ... }`, or a search parameter of the screen\'s route `{ "search": "<name>" }`.',
  )

export const actionParamsSchema = z
  .record(z.string(), paramValueSchema)
  .describe(
    'Per parameter of the action, the anchor whose value it takes, a constant, or a search parameter of the route.',
  )
