/**
 * A transition of a flow, built over the effects it may carry: the canonical one over the
 * effects as XState runs them, the authored one over their shorthands too. A transition may
 * say `read: false`, nothing reads after this outcome, which only a branch of an invoke's
 * `onDone` or `onError` may say (`check/flow/reads.ts` refuses it elsewhere, and beside a
 * `read` of the same branch or an invoke that says it already); XState ignores the key, and
 * the machine comparison leaves it out.
 */

import { z } from '@workspace/zod'

import { DESCRIPTION_PURPOSES } from '../../description-purposes'

import { flowTargetSchema, guardNameSchema } from './names'

/**
 * The opt-out of a read after one outcome of an action: this branch of an invoke's `onDone`
 * or `onError` changes nothing a list of the screen shows, so nothing reads after it, while
 * another branch of the same invoke may read. The canonical flow keeps it on the branch, a
 * statement for the checks and the hand-over diff that XState ignores and the machine
 * comparison leaves out. It sits beside `readOptOutSchema` (`build.ts`), the invoke's own,
 * which says it of every outcome at once.
 */
export const branchReadOptOutSchema = z
  .literal(false)
  .describe(
    "Nothing reads after this outcome: it changes nothing a list of the screen shows, where another outcome of the same action may. Only on a branch of an invoke's `onDone` or `onError`; refused on the transition of an event, beside a `read` on the same branch, and under an invoke that says `read: false` itself.",
  )

/** One transition whose `actions` are `effect`s. */
export const transitionSchemaOf = <E extends z.ZodType>(effect: E) =>
  z
    .strictObject({
      target: flowTargetSchema
        .exactOptional()
        .describe('The state the machine moves to; absent: it stays where it is.'),
      guard: guardNameSchema.exactOptional(),
      read: branchReadOptOutSchema.exactOptional(),
      actions: z.array(effect).min(1).describe('The effects, in order.').exactOptional(),
      description: z.string().exactOptional().describe(DESCRIPTION_PURPOSES.transition),
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
