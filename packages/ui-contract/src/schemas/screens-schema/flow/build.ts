/**
 * The shape of a flow, built over the transitions and effects it may hold and the regions a
 * parallel state may have. The canonical flow, which `createMachine` takes verbatim, is built
 * over the effects and transitions XState runs; the authored flow, which a screen file holds,
 * over their shorthands too and with the region patterns, and the loader expands it into the
 * canonical one. Building both here keeps one shape for the two.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema, kebabNameSchema } from '../../../names.schema'
import { actionNameSchema } from '../anchor'
import { routePathSchema } from '../binding'
import { actionParamsSchema } from '../params'

import {
  flowStateNameSchema,
  guardNameSchema,
  modelEventNameSchema,
  platformEventNameSchema,
  searchSchema,
} from './names'
import { transitionsSchemaOf } from './transitions'

/** The opt-out of a derived toast, which only an authored flow writes and the loader takes away. */
export const toastOptOutSchema = z
  .literal(false)
  .describe(
    'No toast says the success of this action: the flow shows its outcome itself, or it is visible by itself.',
  )

/**
 * A guard by failure code: it holds when the action of the invoke whose `onError` it guards
 * failed with one of its codes, so a bare `show` on its branch shows exactly them.
 */
export const codeGuardSchema = z
  .strictObject({
    codes: z
      .array(codeSchema)
      .min(1)
      .describe('The codes it holds for: the action failed with one of them.'),
  })
  .describe(
    'A guard by failure code, on a branch of an `onError` only: it holds when the action failed with one of its codes.',
  )

const guardSchema = z
  .union([z.string().describe('What the guard holds, in a sentence.'), codeGuardSchema])
  .describe('What a guard holds: a sentence, or the failure codes it holds for.')

/** The parts of a flow below its parallel states, over one `transition` and one `effect`. */
export function flowPartsOf<T extends z.ZodType, E extends z.ZodType>(parts: {
  transition: T
  effect: E
  /** The authored flow's invoke may say `toast: false`; the canonical one has no such key. */
  toastOptOut?: boolean
}) {
  const transitions = transitionsSchemaOf(parts.transition)
  const effects = z.array(parts.effect).min(1).describe('The effects, in order.')
  const invokeShape = {
    src: actionNameSchema.describe('The action the state runs, as a binding names it.'),
    input: actionParamsSchema
      .exactOptional()
      .describe('Per parameter, the anchor whose value it takes or a constant.'),
    onDone: transitions.describe('What follows when the action succeeds.'),
    onError: transitions.exactOptional().describe('What follows when the action fails.'),
  }
  const invoke = (
    parts.toastOptOut === true
      ? z.strictObject({ ...invokeShape, toast: toastOptOutSchema.exactOptional() })
      : z.strictObject(invokeShape)
  ).describe('The action the state runs while the machine is in it.')
  const description = z.string().exactOptional().describe('What the state is, for a reader.')
  const entry = effects.exactOptional().describe('The effects on entering the state.')
  const exit = effects.exactOptional().describe('The effects on leaving the state.')
  const on = z
    .record(z.union([platformEventNameSchema, modelEventNameSchema, anchorSchema]), transitions)
    .exactOptional()
    .describe(
      'Per event, what follows: an anchor (the user acts on it), a platform event of platform.events, or a data event of a field the screen shows.',
    )
  const renders = z
    .array(anchorSchema)
    .min(1)
    .exactOptional()
    .describe(
      'Anchors of the screen that only some states render, this one among them: an anchor no state of the flow lists is rendered in every state, one that a state lists only in the states that list it; a state of a region also renders what its parallel state lists.',
    )
  const meta = z
    .strictObject({
      address: z
        .strictObject({
          path: routePathSchema.exactOptional().describe('The path of a binding of the screen.'),
          search: searchSchema.exactOptional(),
        })
        .exactOptional()
        .describe('The route that reaches this state: a link or a reload restores it.'),
      renders,
    })
    .exactOptional()
    .describe(
      'What the contract says of the state beyond XState: its address and the anchors it renders.',
    )
  const regionMeta = z
    .strictObject({ renders })
    .exactOptional()
    .describe('What the contract says of the state beyond XState: the anchors it renders.')
  const state = z
    .strictObject({
      description,
      type: z.literal('final').exactOptional().describe('The flow ends in this state.'),
      meta,
      entry,
      exit,
      on,
      invoke: invoke.exactOptional(),
    })
    .describe('One state of the flow.')
  const regionState = z
    .strictObject({
      description,
      meta: regionMeta,
      entry,
      exit,
      on,
      invoke: invoke.exactOptional(),
    })
    .describe(
      'One state of a region: a plain state that does not end, has no address and no nested states.',
    )
  const region = z
    .strictObject({
      description: z.string().exactOptional().describe('What the area is, for a reader.'),
      initial: flowStateNameSchema.describe('The state the region starts in.'),
      states: z
        .record(flowStateNameSchema, regionState)
        .describe('The states of the region by name.'),
    })
    .describe(
      'A region of a parallel state: one area of the screen, in one of its states at a time.',
    )

  return { transitions, effects, invoke, description, entry, exit, on, meta, state, region }
}

/** The parts of a flow over one `T` transition and one `E` effect. */
export type FlowParts<T extends z.ZodType, E extends z.ZodType> = ReturnType<
  typeof flowPartsOf<T, E>
>

/**
 * The flow over one `transition` and one `effect`, its parallel states holding the regions
 * `region` makes of the parts (the plain region alone, or with the patterns that expand into
 * one), at least `regions.min` of them: two in the canonical flow; fewer in the authored one,
 * where the loader adds the regions of the buttons the flow leaves out before the canonical
 * flow holds the parallel state to two.
 */
export function flowSchemaOf<
  T extends z.ZodType,
  E extends z.ZodType,
  R extends z.ZodType,
>(options: {
  transition: T
  effect: E
  region: (parts: FlowParts<T, E>) => R
  regions: { min: number; description: string }
  description: string
  /** An invoke may say `toast: false` (the authored flow). */
  toastOptOut?: boolean
}) {
  const { min, description: regionsDescription } = options.regions
  const parts = flowPartsOf({
    transition: options.transition,
    effect: options.effect,
    ...(options.toastOptOut === undefined ? {} : { toastOptOut: options.toastOptOut }),
  })
  const parallel = z
    .strictObject({
      description: parts.description,
      type: z.literal('parallel').describe('Its regions are all active at once, each on its own.'),
      meta: parts.meta,
      entry: parts.entry,
      exit: parts.exit,
      on: parts.on,
      states: z
        .record(flowStateNameSchema, options.region(parts))
        .refine((regions) => Object.keys(regions).length >= min, {
          message: 'a parallel state has two regions or more',
        })
        .meta({ description: regionsDescription, ...(min > 0 ? { minProperties: min } : {}) }),
    })
    .describe(
      'A parallel state: its regions are the independent areas of the screen; an event of its own `on` is handled whichever state each region is in.',
    )

  return z
    .strictObject({
      id: kebabNameSchema
        .exactOptional()
        .describe(
          'The id of the machine: a one-segment name the flow declares, which the app gives its machine, and an id target `#<id>.<state>` names (one segment, as XState splits a target on `.`); absent, the app names the machine by the screen id.',
        ),
      description: z.string().exactOptional().describe('What the flow is, for a reader.'),
      initial: flowStateNameSchema.describe('The state the screen opens in.'),
      meta: z
        .strictObject({
          guards: z
            .record(guardNameSchema, guardSchema)
            .exactOptional()
            .describe(
              'The guards by name, each with what it holds: a sentence, or `{ codes }`, the failure codes it holds for.',
            ),
        })
        .exactOptional()
        .describe('What the contract says of the flow beyond XState: its guards.'),
      states: z
        .record(flowStateNameSchema, z.discriminatedUnion('type', [parts.state, parallel]))
        .describe('The states by name: plain states, and parallel states of regions.'),
    })
    .describe(options.description)
}
