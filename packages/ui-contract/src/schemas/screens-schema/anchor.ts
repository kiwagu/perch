/** One declared anchor of a screen: its kind, what it is bound to, and its attributes. */

import { z } from '@workspace/zod'

import {
  baseAnchorSchema,
  codeSchema,
  errorFieldSchema,
  kebabNameSchema,
  roleSchema,
  stateSchema,
} from '../../names.schema'
import { DESCRIPTION_PURPOSES } from '../description-purposes'

import { actionParamsSchema, sourceParamsSchema } from './params'
import { withoutSchema, withSchema } from './with'

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
        'A field that holds no secret starts with the value of a search parameter of the route and takes it again when the parameter changes; the user may edit the field. See the rule `anchor-binding`.',
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
  .describe(
    'What the anchor does or shows: a field of the model, an action, a route, or (on a field that holds no secret) the search parameter it starts with. See the rules `anchor-binding` and `flow-effects`.',
  )

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
      .describe(
        'The entries come from an entity of the model: the anchor follows the stored data as it changes, here or on another device, and is never read.',
      ),
    z
      .strictObject({
        platform: platformActionNameSchema.describe(
          'The platform action whose result the anchor lists.',
        ),
        params: sourceParamsSchema.optional(),
        paged: z
          .literal(true)
          .optional()
          .describe(
            "The list is a page of the action's entries: its page and size are the route's search parameters, and its parts are derived, never written. See the rule `paged-list`.",
          ),
      })
      .describe(
        'The entries come from a platform action, read when the anchor starts to render, while it renders when what it reads for changes, and where a flow says `read: <anchor>`. See the rule `list-reads`.',
      ),
  ])
  .describe(
    "Where a list's, section's or table's entries come from, and when they are read; no other kind has one. See the rule `list-reads` for when a list reads and the rule `paged-list` for a paged one.",
  )

/** The question a control asks before its destructive action runs, derived by the loader. */
export const asksSchema = z
  .strictObject({
    dialog: z.string().describe("The frame's confirmation that asks."),
    code: codeSchema.describe('The code it asks with: what the action destroys.'),
  })
  .describe(
    "Derived: the control asks the frame's confirmation before its destructive action runs. A screen file never writes it. See the rule `destructive-question`.",
  )

/** The question a control asks before its flow moves to another screen, derived by the loader. */
export const leavesSchema = z
  .strictObject({
    dialog: z
      .string()
      .describe("The frame's dialog that asks whether to leave and lose what was typed."),
    loses: z
      .array(baseAnchorSchema)
      .min(1)
      .describe(
        'The fields of its screen that hold input and that the move does not carry in its search: it asks while one of them holds unsaved input.',
      ),
  })
  .describe(
    "Derived: the control's event moves its flow to another screen, so it asks the frame's leave question first, as a link does.",
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
      .describe(
        "Who sees the element, among the roles its screen's bindings serve. Absent, it adds no limit: those above it and a link's derived roles hold. See the rules `anchor-roles`, `roles` and `link-roles`.",
      ),
    own: z
      .boolean()
      .optional()
      .describe(
        'Shown to a member only on the entries the member owns: the anchor sits in an entry of a list, and shows on the entries the member owns alone. See the rule `own-entries`.',
      ),
    holdsInput: z
      .boolean()
      .optional()
      .describe(
        'True when what is typed stays in the field until an action takes it or a flow clears it, so a leave with it typed loses it; false when it holds none. See the rule `field-holds-input`.',
      ),
    marksState: z
      .literal(false)
      .optional()
      .describe(
        '`false`: an `input`, `textarea` or `select` that holds input shows no state colour, its `data-state` still kept. Left out, it shows it. See the rules `state-colour` and `check-sources`.',
      ),
    secret: z
      .literal(true)
      .optional()
      .describe(
        "A field that holds a secret (a password, its confirmation, a current password): it never comes from or goes into a URL, and leaves only in its action's request. See the rule `secret-field`.",
      ),
    required: z
      .literal(true)
      .optional()
      .describe(
        'An `input` or a `textarea` that holds input and must be filled: while it is empty, a press that sends its form is stopped before the flow, so nothing is sent. See the rule `required-field`.',
      ),
    with: withSchema.optional(),
    without: withoutSchema.optional(),
    codes: z
      .array(codeSchema)
      .optional()
      .describe(
        'The data-code values the element carries. On an `error`, `failed` shows for a failure whose code it does not list, and for one with no code.',
      ),
    ranked: z
      .literal(true)
      .optional()
      .describe(
        'A message whose codes are in rank order: of the codes raised before it shows, it shows the first. Only on a message of two codes or more, each listed once. See the rule `ranked-message`.',
      ),
    fields: z
      .record(codeSchema, errorFieldSchema)
      .optional()
      .describe(
        "An error's codes, each with the field it concerns, which it shows under and marks invalid, or `form`; a code left out concerns the form. See the rules `error-placement` and `error-codes-and-fields`.",
      ),
    dataId: z
      .string()
      .optional()
      .describe(
        'What the `data-id` of the element holds: the id of the entity it shows, on an `item` or a `row`. A `data-id` is data, not contract: no check reads its value. See the rule `attributes`.',
      ),
    dataValue: z
      .boolean()
      .optional()
      .describe(
        "It or its options carry a `data-value`, a choice's stable key, not its label. From version 4 the loader sets it on a select; a screen file omits it there. See the rules `attributes` and `kind-parts`.",
      ),
    states: z
      .array(stateSchema)
      .optional()
      .describe(
        'The `data-state` values it takes: an app, container or row state. Not the field states of an `input`, `textarea` or `select`: `ids` lists those. See the rules `attributes` and `field-states-carried`.',
      ),
    derived: z
      .array(kebabNameSchema)
      .optional()
      .describe(
        "The derived suffixes it renders; a screen file omits a paged list's parts and, from version 4, a kind's own: the loader lists them. See the rules `derived-parts`, `kind-parts` and `visibility-button`.",
      ),
    source: sourceSchema.optional(),
    asks: asksSchema.optional(),
    leaves: leavesSchema.optional(),
    composite: kebabNameSchema
      .optional()
      .describe(
        'The platform composite the field opts into, declared once in `platform.yaml`; the loader derives its list and items. Only a secret `input` opts in. See the rule `composite-of-the-platform`.',
      ),
    derivedFrom: derivedFromSchema.optional(),
    confirms: baseAnchorSchema
      .optional()
      .describe(
        'Written on an unbound secret input: names the other secret input of its screen, one that opts into a composite, whose password it repeats. See the rule `password-pair`.',
      ),
  })
  .describe('One declared anchor.')

/**
 * One declared anchor as a screen file writes it: an error may leave its codes and fields out,
 * and the loader derives them from the actions its part binds; a field may leave `holdsInput`
 * out, and the loader derives it from its kind, its bindings and its flow; a control never writes `asks`,
 * which the loader derives from its action, and may ban it with `confirm: false`; no anchor writes
 * `derivedFrom`, which the loader writes on the anchors it derives from a composite.
 */
export const authoredAnchorDefSchema = anchorDefSchema
  .extend({
    codes: z
      .array(codeSchema)
      .optional()
      .describe(
        '`data-code` values on a `message`, `error`, `toast` or `dialog`: vocabulary or derived toast codes; tests assert them, not words. An error may leave them out. See the rule `error-codes-and-fields`.',
      ),
    fields: z
      .record(codeSchema, errorFieldSchema)
      .optional()
      .describe(
        'Each error code with its field or `form`. From version 3 written entries override the derived code by code; before, they replace them all. See the rules `error-codes-and-fields` and `error-placement`.',
      ),
    holdsInput: z
      .boolean()
      .optional()
      .describe(
        'Whether typed text stays in the field until an action takes it or a `clear` empties it. Left out, it is derived: false where its own change alone applies it at once. See the rule `field-holds-input`.',
      ),
    confirm: z
      .literal(false)
      .optional()
      .describe(
        '`false`: no question before its destructive action. Left out, a control bound to one asks if the frame has a confirmation; refused on others. See the rule `destructive-question`.',
      ),
  })
  .omit({ asks: true, leaves: true, derivedFrom: true })
  .describe('One declared anchor, as a screen file writes it.')
