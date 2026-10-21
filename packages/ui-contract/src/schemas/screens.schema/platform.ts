/** What the platform offers every screen: its actions, its reserved anchors, its status line. */

import { z } from '@workspace/zod'

import {
  anchorSchema,
  baseAnchorSchema,
  codeSchema,
  roleSchema,
  stateSchema,
} from '../../names.schema'

import { platformActionNameSchema } from './anchor'

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
