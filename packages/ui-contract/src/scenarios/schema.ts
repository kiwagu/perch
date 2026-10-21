/** One end-to-end scenario in `screens.json`: the spec-instruction shape. */

import { z } from '@workspace/zod'

import { roleSchema } from '../names.schema'

export const scenarioSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*\/\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/)
      .describe('`<feature>/<nn>-<slug>`, the test `tests/e2e/src/<id>.e2e.spec.ts`.'),
    title: z.string().min(1).describe('What the scenario checks, in a few words.'),
    tags: z.array(z.enum(['smoke', 'full'])).describe('The test tags: `smoke` or `full`.'),
    devices: z
      .record(z.string().regex(/^[A-Z]$/), roleSchema)
      .describe('A letter per browser, each with the role it acts as.'),
    where: z.string().describe('Where the scenario starts, with bracket references.'),
    data: z
      .record(z.string(), z.string())
      .describe('The test data by name: `generate` or a fixed value.'),
    scenario: z.string().describe('The scenario in one sentence.'),
    steps: z.array(z.string()).min(1).describe('The steps, with bracket references.'),
    expected: z.array(z.string()).min(1).describe('The expected results, with bracket references.'),
  })
  .describe('One end-to-end scenario.')
