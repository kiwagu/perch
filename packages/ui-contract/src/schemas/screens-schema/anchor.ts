/** One declared anchor of a screen: its kind, what it is bound to, and its attributes. */

import { z } from '@workspace/zod'

import {
  baseAnchorSchema,
  codeSchema,
  kebabNameSchema,
  roleSchema,
  stateSchema,
} from '../../names.schema'

import { actionParamsSchema } from './params'

const PLATFORM_ACTION = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/

export const platformActionNameSchema = z
  .string()
  .regex(PLATFORM_ACTION)
  .describe('A platform action: `sign-in`, `organisations.create`.')

/** An action a binding runs or a flow invokes: an entity action or a platform action. */
export const actionNameSchema = z
  .string()
  .regex(/^(platform\.[a-z.-]+|[a-z_]+\.[a-zA-Z]+)$/)
  .describe(
    '`entity.action` (an action of the entity x-perch) or `platform.<name>` (an action of platform.actions).',
  )

/** A field of the model: `entity.field`. */
export const modelFieldPathSchema = z
  .string()
  .regex(/^[a-z_]+\.[a-z_]+$/)
  .describe('`entity.field`: a field of an entity of model.schema.json.')

export const bindingRefSchema = z
  .union([
    z
      .strictObject({
        model: modelFieldPathSchema,
      })
      .describe('The anchor shows or edits a field of the model.'),
    z
      .strictObject({
        action: actionNameSchema,
        params: actionParamsSchema.optional(),
      })
      .describe('The anchor runs an action.'),
    z
      .strictObject({
        route: z.string().regex(/^\//).describe('The path of a binding the anchor navigates to.'),
      })
      .describe('The anchor navigates to a route.'),
  ])
  .describe('What the anchor is bound to: a model field, an action or a route.')

export const anchorBindingSchema = z
  .union([
    bindingRefSchema,
    z
      .array(bindingRefSchema)
      .min(1)
      .describe(
        'Several bindings: the anchor runs them in this order, or one of them depending on the mode of the screen; the flow says which.',
      ),
  ])
  .describe('What the anchor is bound to: one binding, or several in a non-empty list.')

export const sourceSchema = z
  .union([
    z
      .strictObject({
        entity: z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .describe('The entity of model.schema.json the anchor lists.'),
        order: z.string().optional().describe('The field the entries are ordered by.'),
        direction: z.enum(['asc', 'desc']).optional().describe('The order direction.'),
      })
      .describe('The entries come from an entity of the model.'),
    z
      .strictObject({
        platform: platformActionNameSchema.describe(
          'The platform action whose result the anchor lists.',
        ),
      })
      .describe('The entries come from a platform action.'),
  ])
  .describe('Where the entries of a list, a section or a table come from.')

export const anchorDefSchema = z
  .strictObject({
    kind: z.string().describe('The kind of the anchor; matches the end of its last segment.'),
    description: z.string().optional().describe('What the element is, for a reader.'),
    binding: anchorBindingSchema.optional(),
    roles: z
      .array(roleSchema)
      .optional()
      .describe('The roles that see the element; absent: every role of the screen.'),
    own: z.boolean().optional().describe('Shown to a member only on the entries the member owns.'),
    codes: z.array(codeSchema).optional().describe('The data-code values the element carries.'),
    fields: z
      .record(codeSchema, baseAnchorSchema)
      .optional()
      .describe(
        "An error's codes, each with the field of the screen it concerns, which the error shows under and marks invalid; a code left out concerns the form.",
      ),
    dataId: z
      .string()
      .optional()
      .describe('What the data-id of the element holds: the id of the entity it shows.'),
    dataValue: z
      .boolean()
      .optional()
      .describe('The element carries a data-value from the choice values.'),
    states: z.array(stateSchema).optional().describe('The data-state values the element takes.'),
    derived: z
      .array(kebabNameSchema)
      .optional()
      .describe('The derived suffixes the element renders: `confirm-button`, `option`.'),
    source: sourceSchema.optional(),
  })
  .describe('One declared anchor.')
