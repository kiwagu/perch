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
        'The field starts with the value of that search parameter of the route the screen was opened at, takes it again each time that parameter becomes another, and the user may change it: `{ search: email }`.',
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
    "What the anchor does or shows. `{ model: <entity>.<field> }`: a field of `model.schema.json` (`$defs.<entity>`). `{ action: <entity>.<action>, params: { ... } }`: an action of the entity's `x-perch.actions`; `{ action: platform.<name> }`: an action of the platform section. Each parameter names the anchor whose value it takes, a constant `{ value: true }`, or `{ search: <name> }`: the value of that search parameter of the route the screen was opened at, which every binding of the screen declares under `search` (the token a link carries). An `item` or a `row` named as a parameter gives the `data-id` of the entry whose control acts: a control (a button, a link, a tab or a field, never a cell or a sibling entry) in the item's part (`<part>.<name>`, like the item), rendered in each entry (`<list>.revoke-button` passes `session: <list>.session-item`, the session of its own row). The item is an entry of a list, a table or a section of its own screen, declared under it or beside it in its part, and declares its `dataId`; an invoke's `input` takes one the same way, in a state that only the events of such controls enter. `{ route: /path }`: the path of a binding of some screen. `{ search: <name> }`, on a field (an input, a textarea, a select, a checkbox, a radio or a switch): the field starts with the value of that search parameter of the route the screen was opened at, takes it again each time that parameter becomes another, and the user may change it; every binding of the screen declares it under `search`. It sits in a list beside the action the field gives its value to: the email a link carried into `/forgot-password?email=...` fills the email input the request is sent with, `[ { search: email }, { action: platform.request-password-reset, params: { email: user.forgot-password.email-input } } ]`. A navigate of another screen's flow carries the value there (`{ anchor: <field> }`, see the rule `flow-effects`). A `secret` field never takes it: a secret is never filled from a URL. A list of bindings means the anchor runs them in that order, or one of them by the mode of the screen; its `flow` says which. `contract:check` holds every binding to what exists: a field, an action, a route, or a search parameter every route of the screen declares.",
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
            "The list is a page of the action's entries: the action declares `paged: { sizes, default }` in `platform.yaml`, the page and the size are the route's search parameters `page` and `size`, which every route of the screen declares (no `params` names them), and a new search starts at page 1. The list derives `range`, `previous-link`, `next-link` and `size-select`, none written by a screen file; the size select holds no input, so its element carries `holdsInput={false}`. A screen pages one list, and a paged list has at most 3 segments. See the rule `paged-list`.",
          ),
      })
      .describe(
        "The entries come from a platform action, which the anchor reads each time it starts to render after it did not (the screen opening, a state that renders it entered after one that did not, the account's role becoming one its roles admit), each time the organisation or account it reads for becomes another or a search parameter it reads does, and where a flow says `read: <anchor>`.",
      ),
  ])
  .describe(
    'Where the entries of a list, a section or a table come from, and with it when they are read; no other kind has one. `{ platform: <action> }`: the entries are the answer of that platform action, which the anchor reads each time it starts to render after it did not and each time what it reads for becomes another, and where a flow says `read: <anchor>`. `{ entity: <entity>, order, direction }`: the stored entries of that entity of the model, which the anchor follows as they change, here or on another device; such a list is never read. See the rule `list-reads` for when a list reads and the rule `paged-list` for a paged one.',
  )

/** The question a control asks before its destructive action runs, derived by the loader. */
export const asksSchema = z
  .strictObject({
    dialog: z.string().describe("The frame's confirmation that asks."),
    code: codeSchema.describe('The code it asks with: what the action destroys.'),
  })
  .describe(
    "Derived: the control asks the frame's confirmation before its action runs, the action being destructive (a delete of the model; a ban, delete, remove or revoke of the platform). Enter in a field of the asking control's form asks the same way.",
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
        "The roles that see the element, among those its screen's bindings serve; absent: every role of the screen. A role is a row of the vocabulary's Roles table, and a device holds a set of them (see the rule `roles`). Every restriction above an anchor admits a device by the roles it holds together: its own `roles`, those of each anchor it is declared under and its screen's (the frame aside), so one restriction naming only roles the route serves is enough, wherever it sits on the chain, and a link to a route whose roles name neither `guest` nor `identity` is shown to no device the route refuses. `contract:check` wants an anchor's roles among those its screen's bindings serve; the manifest carries them, and `contract:diff` lists each role an anchor is shown to as `<anchor> <role>`. A state of a flow may list such an anchor in `meta.renders` like any other, and the state still bounds where it may be visible: an anchor a state does not render is never visible there, and the e2e run's settled check reports it. Where the state does render it, data (the account's roles) decides whether it shows, so the settled check does not require it to be on the page or visible there. A link bound to one route takes the roles of that route when it admits fewer devices than the screen serves: from version 4 the loader derives them and a file never writes roles that admit what the route's do (see the rule `link-roles`). With no `roles` on it, written or derived, and none on an anchor above it, it is shown to every role its screen serves, whoever is signed in.",
      ),
    own: z
      .boolean()
      .optional()
      .describe(
        "Shown to a member only on the entries the member owns: the anchor sits in an entry of a list, and shows on the entries the member owns alone. A state of a flow may list it in `meta.renders` like any other anchor, and the state still bounds where it may be visible: a state that does not render it never shows it, which the e2e run's settled check reports. Where the state does render it, data (the owner of each entry) decides whether it shows, so the settled check does not require it to be on the page or visible there, as it does not for an anchor with `roles`, an entry (`dataId`) or an anchor nested under one of these.",
      ),
    holdsInput: z
      .boolean()
      .optional()
      .describe(
        "A field holds input: what is typed into it stays until an action takes it, so a leave with it typed loses it. False for a field whose own change applies it at once and nothing else applies it: it runs an action that takes the field, or it moves its screen's search with it.",
      ),
    marksState: z
      .literal(false)
      .optional()
      .describe(
        "The field shows no state colour: its border keeps the untouched colour whatever its `data-state`; for a field where fresh input is the point (an entry form). Left out: the field shows it. Only on an `input`, a `textarea` or a `select` that holds input, and never on a form: `contract:check` refuses it elsewhere. The element carries `marksState={false}` in the JSX, which the sources check holds to the contract (see the rule `check-sources`). The manifest carries it in `ids` (the app leaves the border uncoloured; the field's `fieldStates` still hold), and `contract:diff` lists the fields that drop their colour as `<anchor> shows no state colour`.",
      ),
    secret: z
      .literal(true)
      .optional()
      .describe(
        "A field that holds a secret (a password, its confirmation, a current password, anything that never leaves the page but in the request of the action that takes it): no navigate carries it into a search (a `{ anchor }` value would keep it in the address, the browser's history and the logs) and no search parameter starts it (a `{ search }` binding on it is refused); a secret is never filled from a URL. Only a field has it, and only a secret `input` renders a `visibility-button` and opts into a composite. A `clear` of its flow empties it as it empties any field, so it holds no input any more, as if nothing was typed: a form empties its passwords this way once the action that takes them succeeds. Its description may be left out: the engine says it holds a secret the user types and never shows, and the manifest appends `(type password)` once to a written one.",
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
        "What the `data-id` of the element holds: the id of the entity it shows. Declared on an `item` or a `row`, the one static anchor that marks every entry of its list, table or section, the id of each entry's entity going into `data-id`; an entry that differs from the others or changes in place carries a row state, a normal one none. An `item` or a `row` named as a binding parameter, as an invoke's `input` or as a navigate's `{ item }` search takes the `data-id` of the entry whose control acts, so it declares `dataId`; the selection may then be in the address, and a reload or a copied link reaches the same entry. A `data-id` is data, not contract: no check reads its value.",
      ),
    dataValue: z
      .boolean()
      .optional()
      .describe(
        "The element, or its derived options, carry a `data-value` from the choice values: the stable key of a choice that is not an entity, the key the code already uses and never its label, on an `option`, a `badge` or a `button` that switches a mode. Each fixed value is a row of the vocabulary's Choice values table with its meaning. On a `visibility-button` the values are `show` or `hide`, the suffix's own and never rows of the table; on an option of a paged list's `size-select`, the page size it chooses. A behaviour that varies is a value of one anchor, never a second anchor: one `toggle-button` whose `data-value` says which way it switches. A value asserted on an anchor must be one that anchor, or an anchor under it, carries. A select always carries them, so from version 4 the loader derives `dataValue` on it and a file never writes it (see the rule `kind-parts`).",
      ),
    states: z
      .array(stateSchema)
      .optional()
      .describe(
        "The `data-state` values the element takes, each a state of the vocabulary: an app state on the frame's `status`, a container state on a `status`, `list` or `section` (`loading` while its data arrives after the page), a row state on an `item`. An entry that differs from the others or changes in place carries a row state; an entry in its normal state carries none. The state of a field is not written here: an `input`, `textarea` or `select` that holds input carries `unsaved` while it holds input no save has taken, and, when its binding is a model field, `saved` once a save stored what it shows, for as long as it stays on the screen; a reload or leaving the screen clears it. The loader derives it from the vocabulary's Field states table, and the manifest lists it under `fieldStates` (see the rule `field-states-carried`).",
      ),
    derived: z
      .array(kebabNameSchema)
      .optional()
      .describe(
        "The derived suffixes the element renders, each from the vocabulary's closed table of derived suffixes and ending with a kind (the kind of the part it marks). The part is `<anchor>.<suffix>`, which code builds only with `testIdFor(base, suffix)` from `@workspace/ui-contract/anchors`; the loaded base lists every suffix it renders here, and a derived part may have no reference in the screens, scenarios or tests at all, since its declaration is found by the base. No declared anchor equals another plus a derived suffix (`<list>.session-item`, never `<list>.item`). A paged list's four parts, `range`, `previous-link`, `next-link` and `size-select`, are listed by the loader on the list whose source says `paged: true`, and a screen file never writes them (see the rule `paged-list`). From version 4 so are the parts a kind brings by itself, `option` on a select, `visibility-button` on a secret input (the eye of a password input, presentation only: see the rule `visibility-button`), `confirm-button` and `cancel-button` on a dialog and a confirmation, and a screen file writes here only a suffix no kind brings (see the rule `kind-parts`). Before version 4 a file may list them here, and a secret `input` alone lists `visibility-button`.",
      ),
    source: sourceSchema.optional(),
    asks: asksSchema.optional(),
    leaves: leavesSchema.optional(),
    composite: kebabNameSchema
      .optional()
      .describe(
        "The platform composite the field opts into (`password-rules`), one declared once in `platform.yaml` under `composites` where its policy lives: the loader declares on the field's screen `<screen>.<list>` (kind `list`, the composite's description) and `<screen>.<list>.<item>-item` (kind `item`, the item's description, `states: [ <itemState> ]`), right after the input, each marked `derivedFrom`. Only a secret `input` opts in. The derived list and items are declared anchors like any other: the flow's guards, the scenarios, the tests and the sources name them as they name any. Refused: an unknown composite, an opt-in on anything but a secret input, a second opt-in of one composite on a screen, a written anchor whose id a composite derives, two composites deriving one anchor, and a `derivedFrom` a screen file writes. See the rule `composite-of-the-platform`.",
      ),
    derivedFrom: derivedFromSchema.optional(),
    confirms: baseAnchorSchema
      .optional()
      .describe(
        "The secret input of its screen this input confirms, one that opts into a composite: the password typed again names the new password (`confirms: user.reset-password.password-input`). Only a secret `input` with no binding writes it, never sent, once per screen. It takes the value of the input it confirms, and the loader derives the guards of the pair that the screen's flow names. See the rule `password-pair`.",
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
        "Left out, every field (input, textarea, select, checkbox, radio, switch) holds input: what is typed into it stays until an action takes it or a `clear` of its flow empties it, so a leave with it typed loses it, and the app is to ask before such a leave. It holds none when its own change applies it at once and nothing else applies it: one of its bindings runs an action that takes the field itself and that no other anchor of the screen runs with it (the language select), or its own event moves its screen's search with it (a navigate to a path of its screen whose search takes `{ anchor: <the field> }`) and no other anchor's event moves there with it (a filter applied on change). A field whose action a submit button also runs with it (the sign-in email), or whose search a search button moves with it, holds input, and so does one whose event moves to another screen carrying itself: that leaves rather than moves the search. A paged list's derived `size-select` holds none by its facet: its choice sets the route's `size` at once. The loader sets it on every field once the flow is parsed, and a written value wins. The manifest carries it, and `contract:diff` lists the fields that start or stop holding input. The element of a field that holds none carries `holdsInput={false}` in the JSX, which the sources check holds to the contract. See the rules `field-holds-input` and `leave-questions`.",
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
