/**
 * An activity across screens, `contract/domain/activities/<id>.yaml`: what it is for, the roles that
 * take part, what it carries from screen to screen, and an XState v5 machine config whose
 * states are visits to screens. A state names its screen and its address (a binding of that
 * screen) in `meta`, and leaves on an anchor of that screen or of the frame; the screens'
 * flows do the work, so an activity has no `invoke`, no effects, no `entry` or `exit`, and
 * every object is strict. The state names are dot-free, as XState reads a dot in a target as
 * a path into nested states, so the file goes into `createMachine` as written.
 */

import { z } from '@workspace/zod'

import {
  anchorSchema,
  dataNameSchema,
  kebabNameSchema,
  roleSchema,
  screenNameSchema,
} from '../names.schema'

import { guardNameSchema, modelFieldPathSchema, routePathSchema } from './screens-schema'

const stateNameSchema = kebabNameSchema.describe(
  'A state of the activity, a key of its `states`: a visit to a screen, `sign-in`, `signed-out`.',
)

const transitionSchema = z
  .strictObject({
    target: stateNameSchema.describe('The state the activity moves to: the next visit.'),
    guard: guardNameSchema.exactOptional(),
    description: z.string().exactOptional().describe('What happens, for a reader.'),
  })
  .describe('One transition: the user acts on the anchor and reaches the target.')

const transitionsSchema = z
  .union([
    transitionSchema,
    z
      .array(transitionSchema)
      .min(1)
      .describe('Guarded transitions in order: the first whose guard holds is taken.'),
  ])
  .describe('One transition, or a list of guarded ones, the unguarded one last.')

const stateSchema = z
  .strictObject({
    description: z.string().exactOptional().describe('What the visit is, for a reader.'),
    type: z.literal('final').exactOptional().describe('The activity ends in this state.'),
    meta: z
      .strictObject({
        screen: screenNameSchema.describe('The screen the state is a visit to: a screen id.'),
        address: z
          .strictObject({
            path: routePathSchema.describe('The path of a binding of that screen.'),
          })
          .describe('The route of the visit: the activity is where its address is.'),
      })
      .describe('What the contract says of the state beyond XState: its screen and address.'),
    on: z
      .record(anchorSchema, transitionsSchema)
      .exactOptional()
      .describe("Per anchor of the state's screen or of the frame, where acting on it leads."),
  })
  .describe('One state of the activity: a visit to a screen.')

export const activitySchema = z
  .strictObject({
    id: kebabNameSchema.describe('The id of the activity, the name of its file: `session`.'),
    title: z.string().min(1).describe('The title of the activity, for a reader.'),
    description: z
      .string()
      .min(1)
      .describe('What the activity is for: the task it serves across its screens.'),
    roles: z.array(roleSchema).min(1).describe('The roles that take part in the activity.'),
    data: z
      .record(
        dataNameSchema,
        z
          .strictObject({
            description: z.string().min(1).describe('What it is, for a reader.'),
            model: modelFieldPathSchema.exactOptional(),
          })
          .describe('One thing the activity carries, and the field of the model it is.'),
      )
      .exactOptional()
      .describe('What the activity carries from screen to screen, by name.'),
    initial: stateNameSchema.describe('The state the activity starts in.'),
    meta: z
      .strictObject({
        guards: z
          .record(guardNameSchema, z.string())
          .exactOptional()
          .describe('The guards by name, each with what it holds.'),
      })
      .exactOptional()
      .describe('What the contract says of the machine beyond XState: its guards.'),
    states: z.record(stateNameSchema, stateSchema).describe('The states by name: the visits.'),
  })
  .describe('An activity across screens: an XState v5 machine config whose states are visits.')
