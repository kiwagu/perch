/**
 * One screen: its routes, its entry anchors, its declared anchors and its flow. The screen as
 * a file authors it holds the authored flow; the loader expands it into the screen every
 * reader takes, whose flow is the canonical one.
 */

import { z } from '@workspace/zod'

import { anchorSchema, baseAnchorSchema, screenNameSchema } from '../../names.schema'
import { DESCRIPTION_PURPOSES } from '../description-purposes'

import { anchorDefSchema, authoredAnchorDefSchema } from './anchor'
import { bindingSchema } from './binding'
import { authoredFlowSchema, flowSchema } from './flow'

/** One screen over a flow `F` and an anchor `A`: the canonical ones, or those a file holds. */
const screenSchemaOf = <F extends z.ZodType, A extends z.ZodType>(flow: F, anchor: A) =>
  z
    .strictObject({
      id: screenNameSchema,
      title: z.string().min(1).describe('The title of the screen, for a reader.'),
      description: z.string().min(1).describe(DESCRIPTION_PURPOSES.screen),
      frame: z
        .boolean()
        .optional()
        .describe('The frame around every screen: it has no route of its own.'),
      bindings: z
        .array(bindingSchema)
        .describe('The routes of the screen: at least one unless the screen is the frame.'),
      flag: z
        .string()
        .nullable()
        .describe('The feature flag that shows the screen, or null for always.'),
      entry: z
        .array(anchorSchema)
        .min(1)
        .describe('The anchors that are present once the screen is open.'),
      anchors: z.record(baseAnchorSchema, anchor).describe('The declared anchors by name.'),
      states: z
        .record(z.string(), z.string().describe(DESCRIPTION_PURPOSES.containerState))
        .optional()
        .describe('The container states of the screen, each with what is visible in it.'),
      flow: flow.optional(),
      wireframe: z.string().optional().describe('A text sketch of the layout.'),
    })
    .superRefine((screen, context) => {
      if (screen.frame !== true && screen.bindings.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['bindings'],
          message: 'a screen that is not the frame needs at least one binding',
        })
      }
    })
    .describe('One screen of the application.')

export const screenSchema = screenSchemaOf(flowSchema, anchorDefSchema)

export const authoredScreenSchema = screenSchemaOf(authoredFlowSchema, authoredAnchorDefSchema)
