/** `contract/screens.json`: the screens and the platform section they share. */

import { z } from '@workspace/zod'

import { platformSchema } from './platform'
import { screenSchema } from './screen'

export const screensFileSchema = z
  .strictObject({
    $schema: z
      .string()
      .optional()
      .describe('The JSON Schema of this file, for editors: `./screens.schema.json`.'),
    version: z.literal(1).describe('The version of the contract format.'),
    screens: z.array(screenSchema).min(1).describe('The screens of the application.'),
    platform: platformSchema,
  })
  .describe('The screens of the application and the platform they share.')
