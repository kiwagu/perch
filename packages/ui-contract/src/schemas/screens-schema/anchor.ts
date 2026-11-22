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
        'The field starts with the value of a search parameter of the route the screen was opened at, and takes it again when that parameter changes. See the rule `anchor-binding`.',
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
    'What the anchor does or shows: a field of the model, an action, a route, or (on a field alone) the search parameter it starts with. See the rules `anchor-binding` and `flow-effects`.',
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
        'The entries come from a platform action, which the anchor reads when it starts to render and when what it reads for changes. See the rule `list-reads`.',
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
        "The roles that see the element, among those its screen's bindings serve; absent: every role of the screen. See the rules `anchor-roles`, `roles` and `link-roles`.",
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
        'A field holds input: what is typed into it stays until an action takes it, so a leave with it typed loses it. See the rule `field-holds-input`.',
      ),
    marksState: z
      .literal(false)
      .optional()
      .describe(
        'The field shows no state colour: its border keeps the untouched colour whatever its `data-state`. Left out: the field shows it. See the rules `state-colour` and `check-sources`.',
      ),
    secret: z
      .literal(true)
      .optional()
      .describe(
        'A field that holds a secret (a password, its confirmation, a current password): it leaves the page only in the request of the action that takes it, never through a URL. See the rule `secret-field`.',
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
        'A message whose codes are in rank order: of the codes raised before it shows, it shows the first, and the others go with it; a clear of it, in any flow, takes away every code raised before it. A code raised waits until the message shows or a flow clears it. For a message whose codes more than one source may raise before it shows (an effect of the app and a `show` of a flow on its way there): it says which one it shows in its structure, with its `codes` in rank order. Only a message of two codes or more, each listed once: `contract:check` refuses it elsewhere. The manifest carries `ranked` in `ids`, and `contract:diff` lists each ranked message with its order, `<anchor> ranks <code> > <code>`, a new order as the old line removed and the new one added, which its codes compared as a set do not show.',
      ),
    fields: z
      .record(codeSchema, errorFieldSchema)
      .optional()
      .describe(
        "An error's codes, each with the field of the screen it concerns, which the error shows under and marks invalid, or with `form`, the form as a whole; a code left out concerns the form. Every other code shows beside the controls of its part (rule `error-placement`).",
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
        'The element, or its derived options, carry a `data-value` from the choice values: the stable key of a choice that is not an entity, never its label. See the rules `attributes` and `kind-parts`.',
      ),
    states: z
      .array(stateSchema)
      .optional()
      .describe(
        'The `data-state` values the element takes, each a state of the vocabulary. The state of a field is not written here: the loader derives it. See the rules `attributes` and `field-states-carried`.',
      ),
    derived: z
      .array(kebabNameSchema)
      .optional()
      .describe(
        "The derived suffixes the element renders, from the vocabulary's table; the loader lists the parts a paged list or a kind brings. See the rules `derived-parts`, `kind-parts` and `visibility-button`.",
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
        'The secret input of its screen this input confirms, one that opts into a composite: the password typed again names the new password. See the rule `password-pair`.',
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
        "The `data-code` values the element carries, on a `message`, `error`, `toast` or `dialog` (a dialog's code names what it asks, since every dialog looks alike): each a code of the vocabulary's Codes table, which holds its meaning, or a toast code the loader derived. Tests and agents assert the code, never the wording; a domain code (`profile:FORBIDDEN`) is mapped to a contract code (`forbidden`) in the presentation layer and never reaches `data-code`. An error that leaves them out carries the codes of three sources, each once, `failed` last: the failures of the actions the anchors of its part bind (`<part>.<name>` beside `<part>.error`, in the order they are declared); then the failures of the actions its flow invokes and shows on it (a written `onError` in any form, the request pattern, a region written `by` its button); then the codes its flow shows on it explicitly, `show: { <error>: [codes] }` in an `entry`, an `exit` or a transition. What the file writes wins. `contract:diff` lists the codes the anchors gain or lose, written or derived, as `<anchor> <code>`. On an `error`, `failed` shows for a failure whose code it does not list, and for one with no code. See the rule `error-codes-and-fields`.",
      ),
    fields: z
      .record(codeSchema, errorFieldSchema)
      .optional()
      .describe(
        "An error's codes, each with the field of the screen it concerns, which the error shows under and marks invalid, or with `form`, the form as a whole; a code left out concerns the form, and an error may leave both its `codes` and its `fields` out. Every other code shows beside the controls of its part (rule `error-placement`). Each code a field of the model gives, and from version 3 each code a platform action attributes to a parameter, goes to the control the binding or the invoke passes for that field or parameter (`name-too-long` to `user.profile.name-input`), when that control is a field of the screen. Before version 3 a written `fields` replaces the derived one whole, and a code two sources pass from two controls concerns the form; from version 3 the written entries merge over the derived ones code by code, a code two controls pass is a problem until the file writes it (a field or `form`), and an entry equal to the derived one is a problem: leave it out. `contract:diff` lists them as `<error> <code> -> <field>` (`-> form`), written or derived. See the rule `error-codes-and-fields`.",
      ),
    holdsInput: z
      .boolean()
      .optional()
      .describe(
        'Whether the field holds input: what is typed stays until an action takes it, so a leave loses it. Left out, the loader derives it. See the rules `field-holds-input` and `leave-questions`.',
      ),
    confirm: z
      .literal(false)
      .optional()
      .describe(
        "The control runs its destructive action without asking first. Left out, a control whose binding names a destructive action asks the frame's confirmation (an anchor of kind `confirmation` on the frame): an action of the model whose verb is `delete`, or an action of the platform whose verb (the first word of its last segment) is `ban`, `delete`, `remove` or `revoke`. On a control that runs no destructive action it bans nothing and is refused. Without a confirmation on the frame nothing asks. See the rule `destructive-question`.",
      ),
  })
  .omit({ asks: true, leaves: true, derivedFrom: true })
  .describe('One declared anchor, as a screen file writes it.')
