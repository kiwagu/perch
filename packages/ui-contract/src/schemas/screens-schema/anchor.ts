/** One declared anchor of a screen: its kind, what it is bound to, and its attributes. */

import { z } from '@workspace/zod'

import {
  baseAnchorSchema,
  codeSchema,
  kebabNameSchema,
  roleSchema,
  stateSchema,
} from '../../names.schema'
import { DESCRIPTION_PURPOSES } from '../description-purposes'

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
    z
      .strictObject({
        search: z
          .string()
          .regex(/^[a-z][a-zA-Z0-9]*$/)
          .describe('The name of a search parameter every route of the screen declares.'),
      })
      .describe(
        'The field starts with the value of that search parameter of the route the screen was opened at, and the user may change it: `{ search: email }`.',
      ),
  ])
  .describe(
    'What the anchor is bound to: a model field, an action, a route, or the search parameter a field starts with.',
  )

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

/** The question a control asks before its destructive action runs, derived by the loader. */
export const asksSchema = z
  .strictObject({
    dialog: z.string().describe("The frame's confirmation that asks."),
    code: codeSchema.describe('The code it asks with: what the action destroys.'),
  })
  .describe(
    "Derived: the control asks the frame's confirmation before its action runs, the action being destructive (a delete of the model; a delete, remove or revoke of the platform).",
  )

/** Where a derived anchor of a composite comes from, written by the loader only. */
export const derivedFromSchema = z
  .strictObject({
    composite: kebabNameSchema.describe('The composite that derives the anchor.'),
    item: kebabNameSchema
      .optional()
      .describe('The item of the composite the anchor stands for; absent: the list.'),
  })
  .describe(
    'Derived: the anchor is the list, or one item, of a platform composite a field of the screen opted into; a screen file never writes it.',
  )

export const anchorDefSchema = z
  .strictObject({
    kind: z.string().describe('The kind of the anchor; matches the end of its last segment.'),
    description: z.string().optional().describe(DESCRIPTION_PURPOSES.anchor),
    binding: anchorBindingSchema.optional(),
    roles: z
      .array(roleSchema)
      .optional()
      .describe('The roles that see the element; absent: every role of the screen.'),
    own: z.boolean().optional().describe('Shown to a member only on the entries the member owns.'),
    holdsInput: z
      .boolean()
      .optional()
      .describe(
        'A field holds input: what is typed into it stays until an action takes it, so a leave with it typed loses it. False for a field whose own change runs its action, which applies at once.',
      ),
    secret: z
      .literal(true)
      .optional()
      .describe(
        'A field that holds a secret (a password, its confirmation, a current password): it never leaves the page but in the request of the action that takes it, so no navigate carries it into a search and no search parameter starts it; only a secret input renders a `visibility-button`.',
      ),
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
      .describe(
        'The derived suffixes the element renders: `confirm-button`, `option`; an `input` alone renders `visibility-button`, the eye of a password input.',
      ),
    source: sourceSchema.optional(),
    asks: asksSchema.optional(),
    composite: kebabNameSchema
      .optional()
      .describe(
        'The platform composite the field opts into (`password-rules`): the loader derives its list and items on the screen, `<screen>.<list>` and `<screen>.<list>.<item>-item`; only a secret input opts in.',
      ),
    derivedFrom: derivedFromSchema.optional(),
  })
  .describe('One declared anchor.')

/**
 * One declared anchor as a screen file writes it: an error may leave its codes and fields out,
 * and the loader derives them from the actions its part binds; a field may leave `holdsInput`
 * out, and the loader derives it from its kind and its bindings; a control never writes `asks`,
 * which the loader derives from its action, and may ban it with `confirm: false`; no anchor writes
 * `derivedFrom`, which the loader writes on the anchors it derives from a composite.
 */
export const authoredAnchorDefSchema = anchorDefSchema
  .extend({
    codes: z
      .array(codeSchema)
      .optional()
      .describe(
        'The data-code values the element carries. An error that leaves them out carries the codes of the failures of the actions the anchors of its part bind (`<part>.<name>` beside `<part>.error`), each once, `failed` last.',
      ),
    fields: z
      .record(codeSchema, baseAnchorSchema)
      .optional()
      .describe(
        "An error's codes, each with the field of the screen it concerns, which the error shows under and marks invalid; a code left out concerns the form. Left out, each code a field of the model gives goes to the control the binding passes for that field, unless two bindings pass two controls.",
      ),
    holdsInput: z
      .boolean()
      .optional()
      .describe(
        'Left out, every field (input, textarea, select, checkbox, radio, switch) holds input, except one of whose bindings runs an action that takes the field itself as a parameter and that no other anchor of the screen runs with it: a choice that applies at once. A field a submit button runs the action with holds input.',
      ),
    confirm: z
      .literal(false)
      .optional()
      .describe(
        "The control runs its destructive action without asking first. Left out, a control whose binding names a destructive action asks the frame's confirmation.",
      ),
  })
  .omit({ asks: true, derivedFrom: true })
  .describe('One declared anchor, as a screen file writes it.')
