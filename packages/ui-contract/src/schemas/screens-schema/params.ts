/**
 * What an action receives: per parameter, the anchor whose value it takes, a constant, or a
 * search parameter of the route the screen was opened at. A list's platform source passes its
 * action a constant or a search parameter alone, never a field: what a list shows is a state of
 * the address, and what is typed is not.
 */

import { z } from '@workspace/zod'

import { anchorSchema } from '../../names.schema'

const constantSchema = z
  .strictObject({
    value: z
      .union([z.string(), z.number(), z.boolean()])
      .describe('The constant: a string, a number or a boolean.'),
  })
  .describe('A constant the parameter always takes: `{ "value": true }`.')

const searchParameterSchema = z
  .strictObject({
    search: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*$/)
      .describe('The name of a search parameter every route of the screen declares.'),
  })
  .describe(
    'The value of a search parameter of the route the screen was opened at: `{ "search": "token" }`, the token a link carries.',
  )

export const paramValueSchema = z
  .union([
    anchorSchema.describe('The anchor of the control whose value the parameter takes.'),
    constantSchema,
    searchParameterSchema,
  ])
  .describe(
    'An anchor (the control whose value it takes), a constant `{ "value": ... }`, or a search parameter of the screen\'s route `{ "search": "<name>" }`.',
  )

export const actionParamsSchema = z
  .record(z.string(), paramValueSchema)
  .describe(
    'Per parameter of the action, the anchor whose value it takes, a constant, or a search parameter of the route.',
  )

export const sourceParamsSchema = z
  .record(z.string(), z.union([constantSchema, searchParameterSchema]))
  .describe(
    'Per parameter of the action, a search parameter of the route `{ "search": "<name>" }`, which the list reads again when it becomes another, or a constant; never a field. `page` and `size` are never among them: a paged source takes them from the route.',
  )
