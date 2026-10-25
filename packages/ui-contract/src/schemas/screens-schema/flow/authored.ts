/**
 * The flow as a screen file may author it: the canonical flow (`canonical.ts`), plus three
 * shorter forms the loader expands into it, so that what the developer reads is the
 * decisions and the machine stays one to one with XState.
 *
 * - A transition may be its target alone, as XState itself allows: `onDone: idle`.
 * - An effect may be written by its name: `show: <anchor>` (the anchor shows one of the codes
 *   it declares), `show: { <anchor>: [codes] }` (one of these), `clear: <anchor>`,
 *   `navigate: <path>` or `navigate: { to, search }`.
 * - A region may be a pattern, a shape two regions or more of the screens share, named by
 *   what it does: `draft`. A region that fits no pattern is written in full.
 * - The region of a button bound to one action is derived from its binding: a flow that
 *   handles the button nowhere gets it, and `by: <button>` writes it with the outcomes the
 *   screen decides.
 * - In the `onError` of an invoke, `show: <anchor>` shows one of the codes the failure of its
 *   action shows.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema } from '../../../names.schema'
import { routePathSchema } from '../binding'

import { flowSchemaOf } from './build'
import { effectSchema, navigateParamsSchema } from './effects'
import { flowTargetSchema, guardNameSchema, modelEventNameSchema } from './names'
import { transitionSchemaOf, transitionsSchemaOf } from './transitions'

export const showAllSchema = z
  .strictObject({
    show: anchorSchema.describe(
      'The anchor that shows a code: one of the codes the anchor declares, in its order.',
    ),
  })
  .describe('`show: <anchor>`: the anchor shows one of the codes it declares.')

export const showSomeSchema = z
  .strictObject({
    show: z
      .record(anchorSchema, z.array(codeSchema).min(1))
      .refine((one) => Object.keys(one).length === 1, {
        message: 'names one anchor with its codes',
      })
      .meta({ minProperties: 1, maxProperties: 1 })
      .describe('The anchor, with the codes it may show here.'),
  })
  .describe('`show: { <anchor>: [codes] }`: the anchor shows one of these codes.')

export const clearShortSchema = z
  .strictObject({ clear: anchorSchema.describe('The anchor that shows no code any more.') })
  .describe('`clear: <anchor>`: the anchor stops showing its code.')

export const navigateShortSchema = z
  .strictObject({
    navigate: z
      .union([routePathSchema.describe('The path of the binding.'), navigateParamsSchema])
      .describe('The binding the app moves to: its path, or `{ to, search }`.'),
  })
  .describe('`navigate: <path>`: the app moves to that binding.')

export const authoredEffectSchema = z
  .union([effectSchema, showAllSchema, showSomeSchema, clearShortSchema, navigateShortSchema])
  .describe('An effect, in full (`{ type, params }`) or by its name (`show: <anchor>`).')
  .meta({ id: 'authoredEffect' })

export const authoredTransitionSchema = z
  .union([
    flowTargetSchema.describe('The target alone: `idle` is `{ target: idle }`.'),
    transitionSchemaOf(authoredEffectSchema),
  ])
  .describe('One transition, in full or as its target alone.')
  .meta({ id: 'authoredTransition' })

const authoredTransitionsSchema = transitionsSchemaOf(authoredTransitionSchema)

export const controlRegionSchema = z
  .strictObject({
    by: anchorSchema.describe(
      'The button whose region this is: a button of the screen bound to one action. The region rests in `idle`, the button moves it to `running`, which invokes the action with the parameters the binding passes, and both outcomes lead back to `idle`.',
    ),
    description: z.string().exactOptional().describe('What the area is, for a reader.'),
    onDone: authoredTransitionsSchema
      .exactOptional()
      .describe(
        'What follows when the action succeeds; absent, back to `idle`; a transition without a target goes back to `idle` too.',
      ),
    onError: authoredTransitionsSchema
      .exactOptional()
      .describe(
        'What follows when the action fails; absent, back to `idle` with the error of the part (`<part>.error`) showing the codes of the failure; a transition without a target goes back to `idle` too.',
      ),
  })
  .describe(
    'The region of a button bound to one action, with the outcomes the screen decides: the rest comes from its binding.',
  )

export const draftPatternSchema = z
  .strictObject({
    pattern: z
      .literal('draft')
      .describe(
        'A control that follows a stored value or holds what was typed: in `following` it shows the stored value as it changes, here or on another device; typing moves it to `edited`, where it keeps what was typed until that is the stored value again, by typing it back or by the stored value becoming it.',
      ),
    description: z.string().exactOptional().describe('What the area is, for a reader.'),
    input: anchorSchema.describe('The control typed into.'),
    stored: modelEventNameSchema.describe('The data event of the stored value it follows.'),
    guard: guardNameSchema.describe(
      'The guard that holds when what was typed is the stored value, a guard of `meta.guards`.',
    ),
  })
  .describe('The region pattern `draft`: a control that follows a stored value or holds a draft.')

export const authoredFlowSchema = flowSchemaOf({
  transition: authoredTransitionSchema,
  effect: authoredEffectSchema,
  region: (parts) =>
    z
      .union([draftPatternSchema, controlRegionSchema, parts.region])
      .describe(
        'A region written in full, by its pattern (`draft`), or as the region of a button (`by`).',
      ),
  description:
    'The flow of the screen: an XState v5 machine config, which may write a transition as its target, an effect by its name and a region by its pattern or its button, and leave out the region of a button bound to one action; the loader expands it into the config `createMachine` takes.',
})
