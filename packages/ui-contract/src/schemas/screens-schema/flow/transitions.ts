/**
 * A transition of a flow, built over the effects it may carry: the canonical one over the
 * effects as XState runs them, the authored one over their shorthands too.
 */

import { z } from '@workspace/zod'

import { flowTargetSchema, guardNameSchema } from './names'

/** One transition whose `actions` are `effect`s. */
export const transitionSchemaOf = <E extends z.ZodType>(effect: E) =>
  z
    .strictObject({
      target: flowTargetSchema
        .exactOptional()
        .describe('The state the machine moves to; absent: it stays where it is.'),
      guard: guardNameSchema.exactOptional(),
      actions: z.array(effect).min(1).describe('The effects, in order.').exactOptional(),
      description: z.string().exactOptional().describe('What happens, for a reader.'),
    })
    .describe('One transition.')

/** One `transition`, or a list of guarded ones in order. */
export const transitionsSchemaOf = <T extends z.ZodType>(transition: T) =>
  z
    .union([
      transition,
      z
        .array(transition)
        .min(1)
        .describe('Guarded transitions in order: the first whose guard holds is taken.'),
    ])
    .describe('One transition, or a list of guarded ones, the unguarded one last.')
