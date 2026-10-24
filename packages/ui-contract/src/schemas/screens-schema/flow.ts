/**
 * The behaviour of a screen as an XState v5 machine config, in the subset `createMachine`
 * takes verbatim: states, transitions on the anchors' events and the platform's, guards by
 * name, the effects `show`, `clear` and `navigate`, and an invoke per action. A state of the root may
 * be a parallel state, whose regions are the independent areas of the screen, each in one of
 * its plain states at a time; a transition of the root may name a region's state as
 * `<parallel>.<region>.<state>`, and one of a region's state a state of the root as
 * `#<flow id>.<state>`. Everything else XState knows (`context`, `after`, `always`, deeper
 * nesting, history, other targets by `#id`, `.child`, actions named by a string) is refused:
 * every object is strict.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema, kebabNameSchema } from '../../names.schema'

import { actionNameSchema } from './anchor'
import { routePathSchema } from './binding'
import { actionParamsSchema } from './params'

export const flowStateNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .describe('A state of the flow, a key of its `states`: `sign-in`, `signing-in`.')

export const flowTargetSchema = z
  .string()
  .regex(
    /^(#[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*|[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)?)$/,
  )
  .describe(
    'A state of the flow, or of the region the transition is in (`signing-in`); from the root, a state of a region as `<parallel>.<region>.<state>` (`viewing.create-form.open`); from a state of a region, a state of the root as `#<flow id>.<state>` (`#organisation.viewing`).',
  )

export const platformEventNameSchema = z
  .string()
  .regex(/^platform\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  .describe('A platform event: `platform.<name>`, an event of platform.events.')

export const modelEventNameSchema = z
  .string()
  .regex(/^model\.[a-z_]+\.[a-z_]+$/)
  .describe(
    'A data event: `model.<entity>.<field>`, the stored value of a field the screen shows changed, here or on another device.',
  )

export const guardNameSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .describe('A guard: a camelCase name of the flow `meta.guards`.')

const literalSchema = z
  .union([z.string(), z.number(), z.boolean()])
  .describe('A string, a number or a boolean.')

const searchSchema = z
  .record(z.string(), literalSchema)
  .describe('Search parameters of the binding, each a literal (`$id` for a minted id).')

const showSchema = z
  .strictObject({
    type: z.literal('show').describe('The effect: an anchor shows a code.'),
    params: z
      .strictObject({
        anchor: anchorSchema.describe('The anchor that shows the code.'),
        codes: z
          .array(codeSchema)
          .min(1)
          .describe('The codes it may show: its data-code is one of them.'),
      })
      .describe('Which anchor, and the codes it may show.'),
  })
  .describe('The anchor shows one of the codes.')

const clearSchema = z
  .strictObject({
    type: z.literal('clear').describe('The effect: an anchor stops showing its code.'),
    params: z
      .strictObject({
        anchor: anchorSchema.describe('The anchor that shows no code any more.'),
      })
      .describe('Which anchor.'),
  })
  .describe('The anchor shows no code until one is shown again.')

const navigateSchema = z
  .strictObject({
    type: z.literal('navigate').describe('The effect: the app moves to a binding.'),
    params: z
      .strictObject({
        to: routePathSchema.describe('The path of the binding the app moves to.'),
        search: searchSchema.exactOptional(),
      })
      .describe('Which binding, and its search.'),
  })
  .describe('The app moves to that binding.')

export const effectSchema = z
  .discriminatedUnion('type', [showSchema, clearSchema, navigateSchema])
  .describe('An effect, which the implementation provides: `show`, `clear` or `navigate`.')

const effectsSchema = z.array(effectSchema).min(1).describe('The effects, in order.')

export const transitionSchema = z
  .strictObject({
    target: flowTargetSchema
      .exactOptional()
      .describe('The state the machine moves to; absent: it stays where it is.'),
    guard: guardNameSchema.exactOptional(),
    actions: effectsSchema.exactOptional(),
    description: z.string().exactOptional().describe('What happens, for a reader.'),
  })
  .describe('One transition.')

const transitionsSchema = z
  .union([
    transitionSchema,
    z
      .array(transitionSchema)
      .min(1)
      .describe('Guarded transitions in order: the first whose guard holds is taken.'),
  ])
  .describe('One transition, or a list of guarded ones, the unguarded one last.')

const invokeSchema = z
  .strictObject({
    src: actionNameSchema.describe('The action the state runs, as a binding names it.'),
    input: actionParamsSchema
      .exactOptional()
      .describe('Per parameter, the anchor whose value it takes or a constant.'),
    onDone: transitionsSchema.describe('What follows when the action succeeds.'),
    onError: transitionsSchema.exactOptional().describe('What follows when the action fails.'),
  })
  .describe('The action the state runs while the machine is in it.')

const descriptionSchema = z.string().exactOptional().describe('What the state is, for a reader.')

const entrySchema = effectsSchema.exactOptional().describe('The effects on entering the state.')

const exitSchema = effectsSchema.exactOptional().describe('The effects on leaving the state.')

const onSchema = z
  .record(z.union([platformEventNameSchema, modelEventNameSchema, anchorSchema]), transitionsSchema)
  .exactOptional()
  .describe(
    'Per event, what follows: an anchor (the user acts on it), a platform event of platform.events, or a data event of a field the screen shows.',
  )

const metaSchema = z
  .strictObject({
    address: z
      .strictObject({
        path: routePathSchema.exactOptional().describe('The path of a binding of the screen.'),
        search: searchSchema.exactOptional(),
      })
      .exactOptional()
      .describe('The route that reaches this state: a link or a reload restores it.'),
  })
  .exactOptional()
  .describe('What the contract says of the state beyond XState: its address.')

const stateSchema = z
  .strictObject({
    description: descriptionSchema,
    type: z.literal('final').exactOptional().describe('The flow ends in this state.'),
    meta: metaSchema,
    entry: entrySchema,
    exit: exitSchema,
    on: onSchema,
    invoke: invokeSchema.exactOptional(),
  })
  .describe('One state of the flow.')

const regionStateSchema = z
  .strictObject({
    description: descriptionSchema,
    entry: entrySchema,
    exit: exitSchema,
    on: onSchema,
    invoke: invokeSchema.exactOptional(),
  })
  .describe(
    'One state of a region: a plain state that does not end, has no address and no nested states.',
  )

const regionSchema = z
  .strictObject({
    description: z.string().exactOptional().describe('What the area is, for a reader.'),
    initial: flowStateNameSchema.describe('The state the region starts in.'),
    states: z
      .record(flowStateNameSchema, regionStateSchema)
      .describe('The states of the region by name.'),
  })
  .describe('A region of a parallel state: one area of the screen, in one of its states at a time.')

const parallelStateSchema = z
  .strictObject({
    description: descriptionSchema,
    type: z.literal('parallel').describe('Its regions are all active at once, each on its own.'),
    meta: metaSchema,
    entry: entrySchema,
    exit: exitSchema,
    on: onSchema,
    states: z
      .record(flowStateNameSchema, regionSchema)
      .refine((regions) => Object.keys(regions).length >= 2, {
        message: 'a parallel state has two regions or more',
      })
      .meta({ description: 'The regions by name, two or more.', minProperties: 2 }),
  })
  .describe(
    'A parallel state: its regions are the independent areas of the screen; an event of its own `on` is handled whichever state each region is in.',
  )

export const flowSchema = z
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
          .record(guardNameSchema, z.string())
          .exactOptional()
          .describe('The guards by name, each with what it holds.'),
      })
      .exactOptional()
      .describe('What the contract says of the flow beyond XState: its guards.'),
    states: z
      .record(flowStateNameSchema, z.discriminatedUnion('type', [stateSchema, parallelStateSchema]))
      .describe('The states by name: plain states, and parallel states of regions.'),
  })
  .describe('The flow of the screen: an XState v5 machine config.')
