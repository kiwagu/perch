/**
 * What the platform offers every screen: the length a value takes where it names none, the values
 * its parameters refer to, its actions, the events it raises in a flow, the actions that leave
 * what the user typed behind and how every leave that would lose it asks first, the composites it
 * declares once for the screens that opt in, its reserved anchors, its status line.
 */

import { z } from '@workspace/zod'

import {
  anchorSchema,
  baseAnchorSchema,
  codeSchema,
  kebabNameSchema,
  roleSchema,
  stateSchema,
} from '../../names.schema'
import { BEHAVIOUR_PURPOSES, DESCRIPTION_PURPOSES } from '../description-purposes'

import { actionNameSchema, platformActionNameSchema } from './anchor'
import { platformMailSchema, platformNoticeSchema } from './mail'
import { valueKeywords, valueRefSchema, valueSchema } from './value'

const actionParameterSchema = z
  .strictObject({
    type: z
      .string()
      .optional()
      .describe('The type of the value: string, boolean, number; left out where `value` gives it.'),
    value: valueRefSchema.optional(),
    ...valueKeywords,
    optional: z
      .literal(true)
      .optional()
      .describe('The action runs without the parameter: a field that passes it may stay empty.'),
    codes: z
      .array(codeSchema)
      .min(1)
      .optional()
      .describe(
        'The codes of the action whose failure concerns this parameter, each one of its `codes`, beyond those named after it (`<parameter>-<suffix>`). See the rule `attributed-codes`.',
      ),
    description: z.string().describe(DESCRIPTION_PURPOSES.actionParameter),
  })
  .refine((parameter) => parameter.type !== undefined || parameter.value !== undefined, {
    message: 'a parameter writes its `type` or its `value`',
  })
  .describe(
    'One parameter of a platform action: it writes its `type` or the `value` it refers to, and may write the keywords of a value beside it, each only narrowing the value. See the rule `declared-values`.',
  )

export type PlatformParameter = z.infer<typeof actionParameterSchema>

/**
 * The invariants a code of an action names: the action refuses with the code when the rule of any
 * of them would break; a condition of the code's own may stand beside them.
 */
const invariantRefSchema = z
  .strictObject({
    invariant: z
      .union([kebabNameSchema, z.array(kebabNameSchema).min(2).meta({ uniqueItems: true })])
      .refine((named) => typeof named === 'string' || new Set(named).size === named.length, {
        message: 'an invariant is named once',
      })
      .describe(
        'The invariant, by its name under `platform.invariants`, or a list of two or more when several refuse with this code; each has this code as its `refuses`.',
      ),
    condition: z
      .string()
      .min(1)
      .optional()
      .describe(
        'A cause of the code that is no invariant, beside the ones named: when else the action answers with it. At most 200 characters.',
      ),
  })
  .describe(
    'The code answers when the rule of an invariant named would break; each rule is said once, under `platform.invariants`. See the rule `action-outcomes`.',
  )

/**
 * The codes of an action: a map from each code to the condition it answers on, or to the invariants
 * it refuses for with a condition of its own beside them, or, the older form, a list of their names.
 */
const actionCodesSchema = z
  .union([
    z
      .record(
        codeSchema,
        z.union([z.string().min(1).describe(BEHAVIOUR_PURPOSES.condition), invariantRefSchema]),
      )
      .describe(
        'Each code a failure of the action shows, with when it answers: its condition, or the invariants it refuses for, a condition beside. See the rule `action-outcomes`.',
      ),
    z.array(codeSchema).describe('The older form: the codes by name alone, with no condition.'),
  ])
  .describe(
    'The codes a failure of the action shows; from version 3 each that ends like the code of a field concerns a parameter. See the rules `action-outcomes` and `attributed-codes`.',
  )

export type ActionCodes = z.infer<typeof actionCodesSchema>

/** What an action answers once it runs: one outcome, or a list of outcome lines. */
const actionResultSchema = z
  .union([z.string(), z.array(z.string().min(1).describe(BEHAVIOUR_PURPOSES.outcome)).min(1)])
  .describe(
    "What holds once the action runs: one outcome, or a list of outcome lines, the plain success first. A refusal is its code's condition. See the rule `action-outcomes`.",
  )

export type ActionResult = z.infer<typeof actionResultSchema>

/** A rule several platform actions keep, said once. */
export const platformInvariantSchema = z
  .strictObject({
    rule: z.string().min(1).describe(BEHAVIOUR_PURPOSES.rule),
    refuses: codeSchema.describe(
      'The code an action refuses with when the rule would break: each action names the invariant under it.',
    ),
  })
  .describe(
    'A rule several actions keep, said once: each names it under the code it refuses with, and the engine derives the actions it limits. See the rule `action-outcomes`.',
  )

export type PlatformInvariant = z.infer<typeof platformInvariantSchema>

const platformActionSchema = z
  .strictObject({
    description: z.string().describe(DESCRIPTION_PURPOSES.action),
    params: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), actionParameterSchema)
      .describe('The parameters by name.'),
    result: actionResultSchema,
    codes: actionCodesSchema,
    roles: z.array(roleSchema).optional().describe('The roles that may run the action.'),
    paged: z
      .strictObject({
        sizes: z
          .array(z.int().min(1))
          .min(1)
          .describe('The sizes a page may have, each once, the smallest first.'),
        default: z.int().min(1).describe('The size of a page the route does not name, a size.'),
      })
      .optional()
      .describe(
        "The action answers one page: number parameters `page`, from 1, and `size`, one of its sizes; the page in its result's order, with the total the other parameters match. See the rule `paged-list`.",
      ),
    changes: z
      .array(platformActionNameSchema)
      .describe(
        'Required: the list, section or table `source` actions its success changes in its context; never itself, nor a switch of organisation or account. `[]`: none. See the rule `read-after-an-action`.',
      ),
    mail: platformMailSchema.optional().describe('The mail the action sends, when it sends one.'),
    notices: z
      .array(platformNoticeSchema)
      .min(1)
      .optional()
      .describe(
        'The notices the action sends, when it sends any: mails that only tell, with no token, each by its name.',
      ),
  })
  .describe('One platform action.')

/** How a leave that would lose unsaved input asks first, by the kind of leave. */
const unsavedInputSchema = z
  .strictObject({
    question: baseAnchorSchema.describe(
      'The reserved dialog that asks in the app whether to leave and lose what was typed: its code names what it asks, its confirm-button leaves, its cancel-button stays.',
    ),
    screen: z
      .enum(['question', 'never'])
      .describe(
        'A change of screen the user starts: a link, a control whose flow moves to another screen (the loader marks it `leaves`), Back, Forward.',
      ),
    actions: z
      .enum(['question', 'never'])
      .describe('A control bound to an action of `leaving`, before the action runs.'),
    unload: z
      .enum(['browser', 'never'])
      .describe(
        "A reload, closing the tab or the window, an address typed by hand: the browser's own prompt, drawn outside the page, so no anchor or code marks it.",
      ),
    state: z
      .enum(['never', 'question'])
      .describe(
        'A change of state inside one screen: a tab, a search parameter, a form opened or closed.',
      ),
    flow: z
      .literal('never')
      .describe('A navigation a flow makes after its action completed: the action took the input.'),
    elsewhere: z
      .literal('cannot')
      .describe(
        'A leave nobody started here: another tab or device signed the account in or out, a database that will not open, a flow moving on a platform or data event. Nothing here can keep what was typed.',
      ),
  })
  .describe(
    'Every leave that would lose what the user typed and did not save, and how the app asks first: through the question, by the browser, never, or it cannot.',
  )

/** What a value takes where it writes nothing of its own: from version 6, its length. */
export const platformDefaultsSchema = z
  .strictObject({
    maxLength: z
      .int()
      .min(1)
      .describe(
        'Default for writable non-enum strings: platform value, model field or constrained inline param (no `value`). Own limit wins; platform `maxLength: null` opts out. See the rule `declared-values`.',
      ),
  })
  .describe(
    'What a value takes where it writes nothing of its own, said once for every value; from version 6. See the rule `declared-values`.',
  )

export type PlatformDefaults = z.infer<typeof platformDefaultsSchema>

/** A composite the platform declares once, derived into every screen that opts in. */
export const platformCompositeSchema = z
  .strictObject({
    description: z.string().min(1).describe(DESCRIPTION_PURPOSES.composite),
    list: kebabNameSchema
      .regex(/-list$/)
      .describe(
        'The last segment of the list the composite derives on a screen, `<screen>.<list>`: a `list`, so it ends with `-list` (`password-rule-list`).',
      ),
    itemState: stateSchema.describe(
      'The data-state each item takes once what it says holds: a row state of the vocabulary (`met`).',
    ),
    items: z
      .record(kebabNameSchema, z.string().min(1).describe(DESCRIPTION_PURPOSES.compositeItem))
      .refine((items) => Object.keys(items).length > 0, { message: 'a composite has items' })
      .meta({ minProperties: 1 })
      .describe(
        'The items by name, each with its description: the screen gets `<screen>.<list>.<name>-item`, an `item` with the item state.',
      ),
  })
  .describe(
    'A composite the platform declares once where its policy lives: a list with its items, derived into every screen whose field opts in with `composite: <name>`.',
  )

export type PlatformComposite = z.infer<typeof platformCompositeSchema>

export const platformSchema = z
  .strictObject({
    defaults: platformDefaultsSchema.optional(),
    values: z
      .record(kebabNameSchema, valueSchema)
      .optional()
      .describe(
        'The values by name, each declared once where its policy lives (`email`): a parameter of an action takes one by `value: <name>`. See the rule `declared-values`.',
      ),
    actions: z
      .record(platformActionNameSchema, platformActionSchema)
      .describe('The platform actions by name: `platform.<name>` in a binding.'),
    invariants: z
      .record(kebabNameSchema, platformInvariantSchema)
      .optional()
      .describe(
        'The invariants by name: each a rule said once, named by the actions it limits under the code it refuses with. See the rule `action-outcomes`.',
      ),
    events: z
      .record(kebabNameSchema, z.string().describe(DESCRIPTION_PURPOSES.event))
      .optional()
      .describe(
        'The events the platform raises, by name, each with what it means: `platform.<name>` as an event of a flow.',
      ),
    leaving: z
      .array(actionNameSchema)
      .optional()
      .describe(
        'Actions (named as in a binding) that drop typed input, e.g. a sign-out. Ask first only when `unsavedInput.actions` is `question` and a field holds unsaved input. See the rule `leave-questions`.',
      ),
    toasts: z
      .record(platformActionNameSchema, codeSchema)
      .optional()
      .describe(
        "The platform actions whose success toasts, each with its toast's code (`organisations.create: organisation-created`); an unlisted platform action never toasts. See the rule `success-toast`.",
      ),
    composites: z
      .record(kebabNameSchema, platformCompositeSchema)
      .optional()
      .describe(
        'The composites by name: a list with its items the platform declares once (`password-rules`), derived into every screen whose secret input writes `composite: <name>`.',
      ),
    unsavedInput: unsavedInputSchema.optional(),
    reserved: z
      .array(baseAnchorSchema)
      .describe('The anchors the shell owns; a feature never declares them.'),
    status: z
      .strictObject({
        anchor: anchorSchema.describe('The anchor of the readiness line of the app.'),
        states: z.array(stateSchema).min(1).describe('The app states it takes, in order.'),
      })
      .describe('The readiness line of the app.'),
  })
  .describe('What the platform offers every screen.')
