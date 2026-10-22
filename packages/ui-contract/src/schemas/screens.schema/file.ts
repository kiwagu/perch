/**
 * The authored screen files: `contract/screens/<pathname>.yaml`, one screen each, and
 * `contract/platform.yaml`, the contract version with the platform section. An editor
 * finds their JSON Schemas through the hint comment on the first line, never a key.
 */

import { z } from '@workspace/zod'

import { platformSchema } from './platform'
import { screenSchema } from './screen'

/** One file of `contract/screens/`: one screen, as written. */
export const screenFileSchema = screenSchema

export const platformFileSchema = z
  .strictObject({
    version: z.literal(1).describe('The version of the contract format.'),
    ...platformSchema.shape,
  })
  .describe('The version of the contract format and what the platform offers every screen.')
