/** `ui-manifest/manifest.json`, the published contract: today its version and its product. */

import { z } from '@workspace/zod'

export const manifestSchema = z
  .strictObject({
    $schema: z
      .string()
      .optional()
      .describe('The JSON Schema of the file: `./manifest.schema.json`.'),
    manifestVersion: z.literal(1).describe('The version of the manifest format.'),
    product: z
      .strictObject({
        name: z.string().min(1).describe('The product name.'),
        version: z.string().min(1).describe('The version of the root package.json.'),
        commit: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .nullable()
          .describe('The commit the manifest was built from, or null outside git.'),
      })
      .describe('The product the manifest describes.'),
  })
  .describe('The UI manifest: the contract of the application for tests and agents.')
