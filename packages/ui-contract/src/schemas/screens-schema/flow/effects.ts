/**
 * The effects of a flow as XState runs them, `{ type, params }`: `show` (an anchor shows one
 * of its codes), `clear` (a field is emptied, an anchor that carries codes shows none), `read`
 * (a list of the flow's own screen whose `source` is a platform action reads it again) and
 * `navigate` (the app moves to a binding). The implementation provides them; the machine names
 * them.
 */

import { z } from '@workspace/zod'

import { anchorSchema, codeSchema } from '../../../names.schema'
import { routePathSchema } from '../binding'

import { navigateSearchSchema } from './names'

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
    type: z
      .literal('clear')
      .describe('The effect: a field is emptied, or an anchor stops showing its code.'),
    params: z
      .strictObject({
        anchor: anchorSchema.describe(
          'The field to empty, or the anchor that carries codes and shows none any more.',
        ),
      })
      .describe('Which anchor.'),
  })
  .describe(
    'A field is emptied, as if nothing was typed; an anchor that carries codes shows none until one is shown again.',
  )

export const navigateParamsSchema = z
  .strictObject({
    to: routePathSchema.describe('The path of the binding the app moves to.'),
    search: navigateSearchSchema.exactOptional(),
  })
  .describe('Which binding, and its search.')

const navigateSchema = z
  .strictObject({
    type: z.literal('navigate').describe('The effect: the app moves to a binding.'),
    params: navigateParamsSchema,
  })
  .describe('The app moves to that binding.')

const readSchema = z
  .strictObject({
    type: z.literal('read').describe('The effect: a list reads its source again.'),
    params: z
      .strictObject({
        anchor: anchorSchema.describe(
          "The list, section or table of the flow's own screen whose source is a platform action: it reads that action again.",
        ),
      })
      .describe('Which anchor.'),
  })
  .describe(
    "A list of the flow's own screen whose source is a platform action reads that action again and shows its entries once the read is in; the app may take them from the answer of the action that just ran, when it returns them. A list whose source is an entity is never read: it follows the stored data.",
  )

export const effectSchema = z
  .discriminatedUnion('type', [showSchema, clearSchema, readSchema, navigateSchema])
  .describe('An effect, which the implementation provides: `show`, `clear`, `read` or `navigate`.')
