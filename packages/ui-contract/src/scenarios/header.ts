/** The front matter of a scenario file: the structured header of the scenario, nothing else. */

import type { z } from '@workspace/zod'

import { scenarioSchema } from './schema'

export const scenarioHeaderSchema = scenarioSchema.pick({ tags: true, devices: true, data: true })

export type ScenarioHeader = z.infer<typeof scenarioHeaderSchema>
