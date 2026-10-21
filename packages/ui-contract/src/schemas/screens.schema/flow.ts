/** The behaviour of a screen: its states and what each event leads to. */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema } from '../../names.schema'

import { actionParamsSchema } from './params'

const outcomeSchema = z
  .strictObject({
    route: z.string().optional().describe('The route the app moves to.'),
    codes: z.array(codeSchema).optional().describe('The codes the page shows.'),
    state: z.string().optional().describe('The flow state the screen moves to.'),
    note: z.string().optional().describe('Anything else that happens.'),
  })
  .describe('What follows an event.')

const eventSchema = z
  .strictObject({
    on: anchorSchema.describe('The anchor the event happens on.'),
    action: z.string().optional().describe('The action the event runs.'),
    params: actionParamsSchema
      .optional()
      .describe('The parameters this path of the event passes to its action.'),
    guard: z.string().optional().describe('The condition under which the event applies.'),
    from: z.string().optional().describe('The flow state the event leaves.'),
    outcomes: z
      .strictObject({
        success: outcomeSchema.describe('What follows when the action succeeds.'),
        failure: outcomeSchema.optional().describe('What follows when the action fails.'),
      })
      .describe('What follows the event.'),
  })
  .describe('One event of the flow.')

export const flowSchema = z
  .strictObject({
    states: z.array(z.string()).min(1).describe('The states of the screen.'),
    initial: z.string().describe('The state the screen opens in.'),
    events: z.array(eventSchema).describe('The events and their outcomes.'),
  })
  .describe('The flow of the screen.')
