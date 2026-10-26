/**
 * The effects of a flow as XState runs them, `{ type, params }`: `show` (an anchor shows one
 * of its codes), `clear` (it shows none) and `navigate` (the app moves to a binding). The
 * implementation provides them; the machine names them.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema } from '../../../names.schema'
import { routePathSchema } from '../binding'

import { searchSchema } from './names'

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

export const navigateParamsSchema = z
  .strictObject({
    to: routePathSchema.describe('The path of the binding the app moves to.'),
    search: searchSchema.exactOptional(),
  })
  .describe('Which binding, and its search.')

const navigateSchema = z
  .strictObject({
    type: z.literal('navigate').describe('The effect: the app moves to a binding.'),
    params: navigateParamsSchema,
  })
  .describe('The app moves to that binding.')

export const effectSchema = z
  .discriminatedUnion('type', [showSchema, clearSchema, navigateSchema])
  .describe('An effect, which the implementation provides: `show`, `clear` or `navigate`.')
