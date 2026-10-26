/**
 * The authored screen files: `contract/screens/<pathname>.yaml`, one screen each, and
 * `contract/platform.yaml`, the contract version with the platform section. An editor
 * finds their JSON Schemas through the hint comment on the first line, never a key.
 */

import { z } from '@workspace/zod'

import { platformSchema } from './platform'
import { authoredScreenSchema, screenSchema } from './screen'

/** One screen as every reader takes it, its flow expanded. */
export const screenFileSchema = screenSchema

/** One file of `contract/screens/`: one screen, as written, its flow possibly in the authored forms. */
export const authoredScreenFileSchema = authoredScreenSchema

export const platformFileSchema = z
  .strictObject({
    version: z.literal(1).describe('The version of the contract format.'),
    ...platformSchema.shape,
  })
  .describe('The version of the contract format and what the platform offers every screen.')
