/**
 * The behaviour of a screen as an XState v5 machine config, in the subset `createMachine`
 * takes verbatim: flat states, transitions on the anchors' events and the platform's,
 * guards by name, the effects `show` and `navigate`, and an invoke per action. Everything
 * else XState knows (`context`, `after`, `always`, nested and parallel states, targets by
 * `#id` or `.child`, actions named by a string) is refused: every object is strict.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema, screenNameSchema } from '../../names.schema'

import { actionNameSchema } from './anchor'
import { routePathSchema } from './binding'
import { actionParamsSchema } from './params'

export const flowStateNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .describe('A state of the flow, a key of its `states`: `sign-in`, `signing-in`.')

export const platformEventNameSchema = z
  .string()
  .regex(/^platform\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  .describe('A platform event: `platform.<name>`, an event of platform.events.')

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
  .discriminatedUnion('type', [showSchema, navigateSchema])
  .describe('An effect, which the implementation provides: `show` or `navigate`.')

const effectsSchema = z.array(effectSchema).min(1).describe('The effects, in order.')

export const transitionSchema = z
  .strictObject({
    target: flowStateNameSchema
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

const stateSchema = z
  .strictObject({
    description: z.string().exactOptional().describe('What the state is, for a reader.'),
    type: z.literal('final').exactOptional().describe('The flow ends in this state.'),
    meta: z
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
      .describe('What the contract says of the state beyond XState: its address.'),
    entry: effectsSchema.exactOptional().describe('The effects on entering the state.'),
    exit: effectsSchema.exactOptional().describe('The effects on leaving the state.'),
    on: z
      .record(z.union([platformEventNameSchema, anchorSchema]), transitionsSchema)
      .exactOptional()
      .describe(
        'Per event, what follows: an anchor (the user acts on it) or a platform event of platform.events.',
      ),
    invoke: invokeSchema.exactOptional(),
  })
  .describe('One state of the flow.')

export const flowSchema = z
  .strictObject({
    id: screenNameSchema
      .exactOptional()
      .describe('The id of the machine; absent, the app names the machine by the screen id.'),
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
    states: z.record(flowStateNameSchema, stateSchema).describe('The states by name.'),
  })
  .describe('The flow of the screen: an XState v5 machine config.')
