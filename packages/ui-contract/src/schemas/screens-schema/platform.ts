/**
 * What the platform offers every screen: its actions, the events it raises in a flow, the
 * actions that leave what the user typed behind and how every leave that would lose it asks
 * first, its reserved anchors, its status line.
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

import { actionNameSchema, platformActionNameSchema } from './anchor'

const actionParameterSchema = z
  .strictObject({
    type: z.string().describe('The type of the value: string, boolean, number.'),
    description: z.string().describe('What the value is and its limits.'),
  })
  .describe('One parameter of a platform action.')

const platformActionSchema = z
  .strictObject({
    description: z.string().describe('What the action does.'),
    params: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9]*$/), actionParameterSchema)
      .describe('The parameters by name.'),
    result: z.string().describe('What holds once the action succeeds.'),
    codes: z.array(codeSchema).describe('The codes a failure of the action shows.'),
    roles: z.array(roleSchema).optional().describe('The roles that may run the action.'),
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
      .describe('A change of screen the user starts: a link, Back, Forward.'),
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
        'A leave nobody started here: another tab or device signed the account in or out, a database that will not open. Nothing here can keep what was typed.',
      ),
  })
  .describe(
    'Every leave that would lose what the user typed and did not save, and how the app asks first: through the question, by the browser, never, or it cannot.',
  )

export const platformSchema = z
  .strictObject({
    actions: z
      .record(platformActionNameSchema, platformActionSchema)
      .describe('The platform actions by name: `platform.<name>` in a binding.'),
    events: z
      .record(kebabNameSchema, z.string())
      .optional()
      .describe(
        'The events the platform raises, by name, each with what it means: `platform.<name>` as an event of a flow.',
      ),
    leaving: z
      .array(actionNameSchema)
      .optional()
      .describe(
        'The actions whose run leaves what the user typed behind (a sign-out, a switch of organisation, a change of language), as a binding names them: the app is to ask before one runs while a field holds unsaved input.',
      ),
    toasts: z
      .record(platformActionNameSchema, codeSchema)
      .optional()
      .describe(
        'The platform actions whose success toasts, each with the code of its toast (`organisations.create: organisation-created`): an invoke of a listed action gets the standard toast, as an action of the model does; an unlisted platform action never toasts.',
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
