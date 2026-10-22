/**
 * One end-to-end scenario in the spec-instruction shape: what the loader parses a file of
 * `tests/e2e/scenarios` into, and what the manifest carries.
 */

import { z } from '@workspace/zod'

import { roleSchema } from '../names.schema'

/** The second segment of a scenario's id, from the entity on its own to one function. */
const LAYERS = {
  base: 'the entity works on its own',
  flows: 'several roles or devices meet',
  features: 'how one function behaves',
} as const

export const SCENARIO_LAYERS: readonly string[] = Object.keys(LAYERS)

const layers = Object.entries(LAYERS)
  .map(([layer, meaning]) => `\`${layer}\` (${meaning})`)
  .join(', ')

export const scenarioSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*){2,3}$/)
      .describe(
        `\`<entity>/<layer>/<slug>\` or \`<entity>/<layer>/<area>/<slug>\`, the layer one of ${layers}: the path of the file \`tests/e2e/scenarios/<id>.md\`, and the test \`tests/e2e/src/<id>.e2e.spec.ts\`.`,
      ),
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

export type Scenario = z.infer<typeof scenarioSchema>
