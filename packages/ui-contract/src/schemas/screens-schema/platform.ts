/**
 * What the platform offers every screen: its actions, the events it raises in a flow, the
 * actions that leave what the user typed behind, its reserved anchors, its status line.
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
        'The actions whose run leaves what the user typed behind (a sign-out, a switch of organisation, a change of language), as a binding names them: the frame asks before one runs while a field holds unsaved input.',
      ),
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
