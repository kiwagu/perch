/** `contract/screens.json`: the screens, the platform section and the scenarios. */

import { z } from '@workspace/zod'

import { scenarioSchema } from '../../scenarios'

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
    scenarios: z.array(scenarioSchema).describe('The end-to-end scenarios of the application.'),
  })
  .describe('The screens of the application, the platform they share and their scenarios.')
